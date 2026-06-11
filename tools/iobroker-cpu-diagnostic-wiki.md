# ioBroker CPU-Creep Diagnostic für `javascript.*`

> Wiki-artige Analyse und Dokumentation des bereitgestellten Diagnose-Skripts für `ioBroker.javascript`.

## Inhaltsverzeichnis

- [Ziel und Zweck](#ziel-und-zweck)
- [Kurzüberblick](#kurzüberblick)
- [Konfiguration](#konfiguration)
- [Architektur und Datenfluss](#architektur-und-datenfluss)
- [Funktionsanalyse](#funktionsanalyse)
- [HTML-Ausgabe in VIS](#html-ausgabe-in-vis)
- [Interpretation der Messwerte](#interpretation-der-messwerte)
- [Stärken](#stärken)
- [Risiken und Schwachstellen](#risiken-und-schwachstellen)
- [Empfehlungen zur Verbesserung](#empfehlungen-zur-verbesserung)
- [Praxisleitfaden zur Nutzung](#praxisleitfaden-zur-nutzung)
- [Fazit](#fazit)

---

## Ziel und Zweck

Dieses Skript dient dazu, **CPU-Creep** bzw. schleichende Ressourcenakkumulation in `ioBroker.javascript`-Instanzen sichtbar zu machen. Der Fokus liegt nicht nur auf CPU-Zeit, sondern vor allem auf wachsenden internen Ressourcen pro Skript, etwa `timeouts`, `intervals`, `schedules`, `subscriptions`, `messageHandlers` oder `logSubs`.

Die Grundidee ist sinnvoll: Ein fehlerhaftes Skript fällt oft nicht sofort durch hohe CPU-Last auf, sondern durch einen **stetigen Anstieg** aktiver Timer, Subscriptions oder verzögerter States. Genau diese Entwicklung bildet das Skript über Baseline, Delta und Verlauf ab.

---

## Kurzüberblick

| Bereich | Beschreibung |
|---|---|
| Zweck | Diagnose von schleichendem Ressourcenwachstum in mehreren `javascript.*`-Instanzen |
| Transport | Abfrage per `sendToAsync(instance, 'diag', {})` über den Message-Bus |
| Reichweite | Host-übergreifend, solange Zielinstanz erreichbar ist und `diag` unterstützt |
| Ausgabe | HTML-String in State `0_userdata.0.cpu_check` |
| Visualisierung | VIS `Basic -> HTML` Widget |
| Sampling | Standardmäßig alle 30 Sekunden |
| Verlauf | Rolling Window über 10 Minuten |
| Fokus | Top-Skripte nach Gesamtzahl aktiver Ressourcen und Wachstumsdelta seit Start |

---

## Konfiguration

### Relevante Konstanten

| Konstante | Standardwert | Bedeutung |
|---|---:|---|
| `INSTANCES` | `['javascript.0', 'javascript.1', 'javascript.2']` | Zu überwachende JavaScript-Adapterinstanzen |
| `INTERVAL_MS` | `30000` | Messintervall in Millisekunden |
| `HISTORY_MS` | `10 * 60 * 1000` | Historienfenster von 10 Minuten |
| `TOP_N` | `20` | Anzahl der Skripte pro Instanz in der Detailtabelle |
| `TOP_GROWERS` | `5` | Anzahl der stärksten Wachser in der Verlaufszeile |
| `CONTAINER_HEIGHT` | `600` | Höhe des scrollbaren HTML-Containers |
| `STATE_ID` | `0_userdata.0.cpu_check` | Ziel-State für die HTML-Ausgabe |

### Bewertung der Konfiguration

- Die Defaults sind für eine erste Diagnose **praxisnah**.
- Ein 30-Sekunden-Intervall ist ein guter Kompromiss aus Reaktionsfähigkeit und Bus-/Render-Last.
- Das 10-Minuten-Fenster ist kurz genug, damit der State nicht ausufert, aber lang genug, um Trends sichtbar zu machen.
- `TOP_N = 20` ist für VIS noch gut lesbar; bei vielen Skripten kann das trotzdem dicht wirken.

---

## Architektur und Datenfluss

```text
javascript-Diagnoseskript
        |
        | sendToAsync(..., 'diag', {})
        v
alle konfigurierten javascript.*-Instanzen
        |
        | Rückgabe: global + perScript
        v
Aufbereitung pro Instanz
        |
        | Baseline / Delta / CPU-Prozent / History
        v
HTML-Generierung
        |
        v
State: 0_userdata.0.cpu_check
        |
        v
VIS HTML Widget
```

### Interner Zustand

Das Skript hält zwei zentrale Datenstrukturen im Speicher:

| Struktur | Zweck |
|---|---|
| `stateByInstance` | Merkt sich pro Instanz die Baseline je Skript und den letzten CPU-Messpunkt |
| `history` | Hält die Verlaufseinträge innerhalb des letzten 10-Minuten-Fensters |

Das ist effizient, weil keine externe Persistenz nötig ist. Gleichzeitig bedeutet es aber auch: **nach Skriptneustart beginnt die Baseline wieder bei null**.

---

## Funktionsanalyse

### `totalOf(s)`

Diese Funktion summiert alle relevanten Ressourcen eines Skripts zu einer Kennzahl `total`:

- `stateSubs`
- `fileSubs`
- `objectSubs`
- `timeouts`
- `intervals`
- `schedules`
- `delayedStates`
- `messageHandlers`
- `logSubs`

**Bewertung:**

- Für die Leak-Suche ist diese Verdichtung sehr nützlich.
- Sie ist aber keine echte Qualitätsmetrik, sondern ein **Heuristik-Score**.
- Nicht jede Ressource ist gleich teuer; ein `interval` kann kritischer sein als eine zusätzliche `logSub`.

### `esc(v)`

HTML-Escaping für `&`, `<`, `>` und `"`.

**Bewertung:**

- Sauber und notwendig, weil Skriptnamen oder Ressourcenbezeichner direkt in HTML geschrieben werden.
- Verhindert Darstellungsfehler und triviale HTML-Injektion.

### `cpuStyle(pct)`

Farbliche Hervorhebung der CPU-Last:

| CPU-% | Stil |
|---|---|
| `< 20` | kein Spezialstil |
| `20 - 49.9` | orange |
| `>= 50` | rot und fett |

**Bewertung:**

- Gut verständlich.
- Für ein produktives Monitoring wäre zusätzlich eine konfigurierbare Schwellwertlogik sinnvoll.

### `instanceDetail(instance, res, cpuLine, cpuPct)`

Erzeugt den Hauptblock je Instanz:

- Kopfzeile mit Instanzname und CPU-Zeile
- Subline mit Skriptanzahl, RSS, Heap und Summen-Subscriptions
- Optional `activeResources`
- Detailtabelle der Top-Skripte

Die Tabelle sortiert nach `total`, also nach der Gesamtzahl aktiver Ressourcen. Das Delta `Δstart` berechnet sich relativ zur ersten Beobachtung der laufenden Session.

**Wichtig:** Eine rote Zeile bedeutet nicht automatisch Fehler. Kritisch wird sie dann, wenn `Δstart` über mehrere Samples **kontinuierlich steigt**.

### `instanceSummary(instance, res, cpuPct)`

Erzeugt die kompakte Verlaufsdarstellung pro Instanz:

- CPU-Prozent
- RSS
- Liste der größten Wachser (`TOP_GROWERS`)

Das ist gut gelöst, weil die Historie bewusst kompakt bleibt. So lässt sich auch in VIS auf kleiner Fläche ein Trend lesen.

### `sampleInstance(instance)`

Das ist die zentrale Messfunktion.

Ablauf:

1. Zustand der Instanz aus `stateByInstance` laden oder initialisieren.
2. Per `sendToAsync` Diagnosedaten abrufen.
3. Offline-/Fehlerfälle als graue Statusmeldung zurückgeben.
4. CPU-Prozent aus Differenz von CPU-Zeit und Wall-Time berechnen.
5. Baseline beim ersten gültigen Sample setzen.
6. Detail- und Summary-HTML zurückgeben.

**CPU-Berechnung:**

Die Formel ist logisch:

- `wallMs = now - prev.now`
- `cpuMs = (cpuUserMs + cpuSystemMs) - vorheriger Wert`
- `cpuPct = (cpuMs / wallMs) * 100`

### Interpretation der CPU-Messung

Diese Prozentzahl ist **keine absolute System-CPU**, sondern die auf das Intervall bezogene CPU-Zeit der jeweiligen JavaScript-Instanz. Das ist für Trendbeobachtung passend, kann aber missverstanden werden.

Besonders bei Mehrkernsystemen und Adapter-internen Messgrößen sollte man den Wert als **indikative Lastmetrik** lesen, nicht als exakte OS-CPU-Anzeige.

### `sample()`

Diese Funktion orchestriert den gesamten Zyklus:

- Alle Instanzen parallel messen via `Promise.all`
- Verlaufszeile hinzufügen
- Historie auf 10 Minuten trimmen
- HTML komplett zusammensetzen
- HTML in den Ziel-State schreiben

**Bewertung:**

- Parallelisierung ist richtig und reduziert Zyklusdauer.
- Die History wird sauber beschnitten, wodurch State-Größe und VIS-Last begrenzt bleiben.

### `main()`

Initialisiert den State, schreibt eine Logmeldung, führt sofort ein erstes Sample aus und startet dann den Timer.

Außerdem wird per `onStop()` das Intervall beim Skriptstopp aufgeräumt. Das ist wichtig und sauber implementiert.

---

## HTML-Ausgabe in VIS

### Aufbau der Ausgabe

Die generierte HTML-Struktur besteht aus drei Ebenen:

| Ebene | Inhalt |
|---|---|
| Header | Zeitstempel, Sampling-Intervall, Verlaufsfenster |
| Detailbereich | Pro Instanz eine Tabelle mit Skript-Ressourcen |
| Verlaufsbereich | Kompakte historische Samples, neueste zuerst |

### Styling-Konzept

Das CSS ist komplett inline definiert. Das hat im VIS-Kontext klare Vorteile:

- Keine Abhängigkeit von externen CSS-Dateien
- Widget ist sofort renderbar
- Transport ausschließlich über einen HTML-State

### Positive Punkte

- Monospace-Schrift passt zum Diagnosecharakter.
- Feste Containerhöhe mit `overflow:auto` ist für VIS sehr praktisch.
- Hervorhebung wachsender Zeilen per leicht rotem Hintergrund ist gut erkennbar.
- Die Subline trennt Systemmetadaten von Skriptdetails sinnvoll.

### Mögliche UI-Schwächen

| Thema | Bewertung |
|---|---|
| Mobile/kleine Widgets | Tabelle kann schnell zu breit werden |
| Farbcodierung allein | Für Barrierefreiheit nicht ideal |
| Sehr viele Skripte | Top-20 bleibt übersichtlich, verbirgt aber ggf. kleinere Leaks |
| Reines HTML im State | Debuggen und Weiterverarbeitung sind schwerer als bei JSON |

---

## Interpretation der Messwerte

### Spaltenbedeutung

| Spalte | Bedeutung | Typischer Hinweis bei Wachstum |
|---|---|---|
| `total` | Summe aller erfassten Ressourcen | genereller Verdacht auf Akkumulation |
| `Δstart` | Wachstum seit dem ersten Sample | zentraler Leak-Indikator |
| `tmo` | aktive Timeouts | nicht aufgeräumte `setTimeout`-Nutzung |
| `intv` | aktive Intervalle | klassischer `setInterval`-Leak |
| `sched` | Schedules | mehrfach registrierte Cron-/Scheduler-Jobs |
| `delayed` | verzögerte States | aufgestaute verzögerte Aktionen |
| `state` | State-Subscriptions | doppelte oder unendliche `on()`-Registrierungen |
| `wild` | Wildcard-Subscriptions | besonders kritisch, wenn breit gefächert |
| `file` | File-Subscriptions | selten, aber beobachtbar |
| `obj` | Objekt-Subscriptions | unnötige Objektbeobachtung |
| `msg` | Message-Handler | mehrfach gebundene Handler |
| `logSub` | Log-Subscriptions | nicht entfernte Log-Abos |

### Typische Muster

#### Unkritisch

- `Δstart` bleibt über längere Zeit stabil.
- Einzelne Peaks fallen später wieder zurück.
- CPU steigt kurz, aber Ressourcen wachsen nicht nachhaltig.

#### Verdächtig

- Ein Skript zeigt `Δstart` in fast jedem Sample weiter ansteigend.
- Besonders `intervals`, `timeouts` oder `stateSubs` nehmen monoton zu.
- CPU-Prozent steigt parallel mit dem Ressourcenwachstum.

#### Stark verdächtig

- Mehrere Ressourcentypen wachsen gemeinsam, etwa `stateSubs` und `messageHandlers`.
- Historie zeigt denselben Skriptnamen wiederholt unter den `TOP_GROWERS`.
- RSS/Heap wächst mit, ohne sich wieder zu normalisieren.

---

## Stärken

### Funktionale Stärken

- **Instanzübergreifend:** geeignet für verteilte Setups mit mehreren `javascript.*`-Instanzen.
- **Direkter VIS-Nutzen:** keine Zusatzkomponenten nötig.
- **Trendorientiert:** nicht nur Snapshot, sondern Baseline plus Verlauf.
- **Leichtgewichtig:** keine DB, keine Fremdbibliothek, keine persistente Historie.
- **Gute Fehlerbehandlung:** Offline- oder ungültige Antworten werden sichtbar markiert.

### Technische Stärken

- Klare Struktur und gut lesbarer Code.
- Sinnvolle Trennung von Detail- und Summary-Darstellung.
- Sauberes Lifecycle-Handling mit `onStop(clearInterval)`.
- HTML-Escaping vorhanden.
- History-Trim verhindert Datenflut im State.

---

## Risiken und Schwachstellen

### 1. Abhängigkeit von `diag`

Das Skript funktioniert nur dann vollständig, wenn die Zielinstanz auf `sendTo(..., 'diag', {})` sinnvoll antwortet. Ohne diese Gegenstelle ist das Monitoring blind.

**Folge:** Vor produktiver Nutzung muss geprüft werden, ob alle `javascript.*`-Instanzen dieselbe Diagnoseschnittstelle bereitstellen.

### 2. Baseline nur im RAM

Die Baseline wird nur im Arbeitsspeicher gehalten. Nach Neustart des Skripts oder der Engine ist die Referenz weg.

**Folge:** Langfristige Vergleiche über Neustarts hinweg sind nicht möglich.

### 3. `total` gewichtet alle Ressourcen gleich

Die Summenbildung ist praktisch, aber grob. Eine zusätzliche `wildcardSub` kann in der Realität schwerwiegender sein als mehrere harmlose Einträge in anderen Kategorien.

**Folge:** Die Sortierung zeigt Auffälligkeiten, aber keine echte Priorisierung nach Performance-Auswirkung.

### 4. CPU-Wert potenziell missverständlich

`cpuPct` ist als Trendwert nützlich, aber ohne genaue Definition der Ursprungscounter leicht fehlinterpretierbar.

**Folge:** Anwender könnten den Wert mit OS-CPU-Auslastung verwechseln.

### 5. HTML statt strukturierter Daten

Die direkte HTML-Erzeugung ist für VIS bequem, aber analytisch limitiert.

**Nachteile:**

- keine einfache Weiterverarbeitung in Grafana/InfluxDB
- schwerere externe Analyse
- Layout und Daten sind eng gekoppelt

### 6. Kein Schutz gegen große Namensmengen

Wenn sehr viele Skripte existieren oder ungewöhnlich lange Skriptnamen vorkommen, kann die HTML-Ausgabe unübersichtlich werden.

---

## Empfehlungen zur Verbesserung

### Priorität A: Daten und Darstellung trennen

**Empfehlung:** Neben dem HTML zusätzlich einen JSON-State schreiben, z. B. `0_userdata.0.cpu_check_json`.

| Vorteil | Nutzen |
|---|---|
| VIS bleibt nutzbar | HTML kann weiter direkt dargestellt werden |
| Analyse wird besser | JSON ist für Debugging, Logging und Export geeignet |
| Erweiterbarkeit | spätere Diagramme oder Alarme einfacher |

### Priorität B: Gewichtete Leak-Score-Formel

Statt aller Ressourcen mit Gewicht `1` zu summieren, könnte ein gewichteter Score aussagekräftiger sein.

Beispiel:

```text
score = 3*intervals + 3*timeouts + 4*wildcardSubs + 2*stateSubs + 2*messageHandlers + 1*logSubs + ...
```

Damit würden schwerwiegende Muster schneller nach oben rutschen.

### Priorität C: Persistente Baseline oder Rolling Baseline

Zwei sinnvolle Varianten:

- **Persistente Baseline:** Baseline in separatem State speichern.
- **Rolling Baseline:** Delta nicht seit Start, sondern z. B. gegen vor 10 Minuten oder gegen Median der letzten N Samples.

Das macht die Aussage robuster bei Neustarts und bei sehr langen Laufzeiten.

### Priorität D: Schwellenwerte und Alarme

Sinnvoll wären konfigurierbare Schwellwerte, zum Beispiel:

- `Δstart > 20`
- `intervals` wächst in 5 Samples hintereinander
- `cpuPct > 40` für 3 Intervalle

Dann könnte das Skript zusätzlich Warnungen loggen oder einen Alarm-State setzen.

### Priorität E: Bessere VIS-Lesbarkeit

UI-Ideen:

- Sticky Table Header
- Kurzlabels mit Tooltip für Spalten
- optionale Sortierung nach `Δstart` statt `total`
- kleine Sparklines oder Trendpfeile
- Farbpalette mit höherem Kontrast

---

## Praxisleitfaden zur Nutzung

### Vorgehen bei der Fehlersuche

1. Skript starten und einige Minuten laufen lassen.
2. Auf `Δstart` achten, nicht nur auf `total`.
3. Prüfen, welche Spalten wachsen (`intv`, `state`, `wild`, `msg` sind oft besonders aufschlussreich).
4. Historie lesen: taucht derselbe Skriptname wiederholt als Grower auf?
5. Verdächtiges Skript gezielt im Quellcode prüfen.

### Typische Ursachen im Zielskript

| Muster im Diagnose-Output | Wahrscheinliche Ursache im Skript |
|---|---|
| `intv` wächst | `setInterval()` wird mehrfach angelegt, aber nie `clearInterval()` |
| `tmo` wächst | rekursive oder wiederholte `setTimeout()`-Erzeugung ohne Aufräumen |
| `state` wächst | `on()` in Funktionen/Callbacks registriert sich mehrfach |
| `wild` wächst | zu breite oder wiederholt angelegte Wildcard-Subscriptions |
| `msg` wächst | `onMessage` oder vergleichbare Handler mehrfach gebunden |
| `logSub` wächst | Logging-Subscription wird mehrfach aktiviert |
| `delayed` wächst | Stau verzögerter `setStateDelayed()`-Operationen |

### Gute Einsatzszenarien

- Nach Deploy neuer JavaScript-Skripte
- Bei unerklärlich wachsender Adapterlast
- Bei Heap-/RSS-Anstieg über längere Laufzeit
- In Multi-Host-Setups zur schnellen Eingrenzung der Probleminstanz

---

## Fazit

Das Skript ist für den vorgesehenen Zweck **sehr brauchbar**: Es ist pragmatisch, VIS-tauglich und fokussiert genau auf die Klasse von Problemen, die in ioBroker oft schwer zu finden ist — schleichende Akkumulation von Timern, Subscriptions und Handlern.

Die größte Stärke ist die Kombination aus **aktueller Detailansicht**, **Delta seit Start** und **kompakter Historie**. Die größten Verbesserungshebel liegen in strukturierter Zweitausgabe (JSON), gewichteter Bewertung, optionaler Persistenz der Baseline und klareren Alarmregeln.

---

## Anhang: Kurze Codebewertung

| Kriterium | Einschätzung |
|---|---|
| Lesbarkeit | sehr gut |
| Wartbarkeit | gut bis sehr gut |
| VIS-Tauglichkeit | sehr gut |
| Diagnosewert | hoch |
| Erweiterbarkeit | gut |
| Langzeit-Analyse | mittel |
| Maschinenlesbarkeit | eher gering |

### Gesamturteil

<span style="color:#2e7d32"><strong>Empfehlenswert für die operative Leak-Suche in ioBroker-JavaScript-Instanzen.</strong></span>

Für ein dauerhaftes Monitoring würde sich eine zweite, strukturierte Datenebene zusätzlich lohnen.

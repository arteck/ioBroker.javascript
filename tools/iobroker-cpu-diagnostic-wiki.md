# 🔍 ioBroker CPU-Creep Diagnostic für `javascript.*`

> [!NOTE]
> Diese Version ist für **GitHub Markdown** optimiert: mit klarer Seitenstruktur, Emojis, Callouts, Tabellen und einer stärker scannbaren Darstellung für Doku, Repository-Wiki oder Knowledge Base.

## 📚 Inhaltsverzeichnis

- [🎯 Zielbild](#-zielbild)
- [⚡ Executive Summary](#-executive-summary)
- [🧩 Konfiguration](#-konfiguration)
- [🏗️ Architektur](#️-architektur)
- [🛠️ Funktionsanalyse](#️-funktionsanalyse)
- [🖥️ VIS-Ausgabe](#️-vis-ausgabe)
- [📈 Interpretation der Metriken](#-interpretation-der-metriken)
- [✅ Stärken](#-stärken)
- [⚠️ Schwachstellen](#️-schwachstellen)
- [🚀 Verbesserungen](#-verbesserungen)
- [🧪 Praxisleitfaden](#-praxisleitfaden)
- [🏁 Gesamtbewertung](#-gesamtbewertung)

---

## 🎯 Zielbild

Dieses Skript soll den **CPU-Creep** bzw. allgemeiner die **schleichende Ressourcenakkumulation** in `ioBroker.javascript`-Instanzen sichtbar machen.

Es beobachtet dafür pro Skript unter anderem:

- ⏱️ `timeouts`
- 🔁 `intervals`
- 🗓️ `schedules`
- 💤 `delayedStates`
- 📡 `stateSubs`
- 🌐 `wildcardSubs`
- 📁 `fileSubs`
- 🧱 `objectSubs`
- 📨 `messageHandlers`
- 🪵 `logSubs`

Der eigentliche Mehrwert liegt darin, dass nicht nur ein Momentzustand gezeigt wird, sondern auch das **Wachstum seit der ersten Messung** (`Δstart`) und ein **kompakter Verlauf** der letzten 10 Minuten.

> [!TIP]
> Genau solche schleichenden Anstiege sind in ioBroker oft aussagekräftiger als eine einmalig hohe CPU-Last.

---

## ⚡ Executive Summary

| Bereich | Einschätzung |
|---|---|
| Nutzen | **Hoch** – sehr brauchbar für die operative Leak-Suche |
| VIS-Tauglichkeit | **Sehr hoch** – direkt als HTML-State nutzbar |
| Codequalität | **Gut bis sehr gut** – klar strukturiert und sauber getrennt |
| Diagnosewert | **Hoch** – Baseline, Delta und Verlauf sind sinnvoll kombiniert |
| Schwächen | Baseline nur im RAM, HTML statt JSON, `total` nur heuristisch |
| Ausbaupotenzial | Gewichteter Score, JSON-Ausgabe, Alarme, persistente Baseline |

> [!IMPORTANT]
> Das Skript ist **kein klassisches CPU-Monitoring**, sondern ein **Leak-/Akkumulationsdetektor** mit CPU-Bezug.

---

## 🧩 Konfiguration

### Relevante Parameter

| Parameter | Default | Bedeutung |
|---|---:|---|
| `INSTANCES` | `['javascript.0', 'javascript.1', 'javascript.2']` | Alle zu überwachenden Instanzen |
| `INTERVAL_MS` | `30000` | Sampling alle 30 Sekunden |
| `HISTORY_MS` | `10 * 60 * 1000` | Historie über 10 Minuten |
| `TOP_N` | `20` | Anzahl sichtbarer Skripte pro Instanz |
| `TOP_GROWERS` | `5` | Anzahl genannter Wachser in der Verlaufszeile |
| `CONTAINER_HEIGHT` | `600` | Höhe des Scrollcontainers im VIS |
| `STATE_ID` | `0_userdata.0.cpu_check` | Ziel-State für HTML |

### Bewertung

- ✅ Die Defaults sind **praxisnah** für eine erste Analyse.
- ✅ 30 Sekunden Sampling ist ein guter Mittelweg zwischen Reaktionsgeschwindigkeit und Zusatzlast.
- ✅ Das 10-Minuten-Fenster hält den State klein und bleibt trotzdem trendfähig.
- ⚠️ Bei sehr vielen Skripten oder dicht belegten Instanzen kann `TOP_N = 20` trotzdem knapp werden.

---

## 🏗️ Architektur

```text
Diagnoseskript
   |
   | sendToAsync(instance, 'diag', {})
   v
javascript.0 / javascript.1 / javascript.2
   |
   | Rückgabe: global + perScript
   v
Aufbereitung im Sammelskript
   |
   | Baseline + CPU-Differenz + Verlauf + HTML
   v
State: 0_userdata.0.cpu_check
   |
   v
VIS HTML Widget
```

### Zentrale Datenstrukturen

| Struktur | Aufgabe |
|---|---|
| `stateByInstance` | Hält pro Instanz Baseline und letzte CPU-Messwerte |
| `history` | Rolling Window der letzten Verlaufszeilen |

> [!NOTE]
> Die Baseline lebt nur im Speicher des Skripts. Nach einem Neustart beginnt die Beobachtung wieder von vorne.

---

## 🛠️ Funktionsanalyse

### `totalOf(s)`

Bildet einen zusammengefassten Ressourcenwert pro Skript.

**Positiv:**
- ✅ Sehr gut als schnelle Heuristik für auffällige Skripte.
- ✅ Einfach vergleichbar und gut sortierbar.

**Einschränkung:**
- ⚠️ Nicht jede Ressource ist gleich kritisch.
- ⚠️ `intervals` oder `wildcardSubs` können praktisch schwerer wiegen als andere Zähler.

---

### `esc(v)`

Escaped HTML-Sonderzeichen vor der Ausgabe in die Tabelle.

**Bewertung:**
- ✅ Korrekt und notwendig.
- ✅ Verhindert HTML-Artefakte und triviale Injektionen in der Darstellung.

---

### `cpuStyle(pct)`

Setzt CPU-Farben nach Schwellwert:

| CPU-Wert | Wirkung |
|---|---|
| unter 20 % | neutral |
| ab 20 % | orange |
| ab 50 % | rot + fett |

> [!TIP]
> Für Betriebsteams wäre das noch besser, wenn die Grenzwerte konfigurierbar wären.

---

### `instanceDetail(instance, res, cpuLine, cpuPct)`

Erzeugt den Detailblock je Instanz mit:

- Instanzkopf
- CPU-Zeile
- Speicher-/Subscription-Zusammenfassung
- optionalen `activeResources`
- Detailtabelle der Top-Skripte

Die Sortierung erfolgt nach `total`, nicht nach `Δstart`.

> [!IMPORTANT]
> Eine rote Zeile heißt nicht automatisch „defekt“. Entscheidend ist, ob `Δstart` über mehrere Samples **kontinuierlich weiter steigt**.

---

### `instanceSummary(instance, res, cpuPct)`

Baut die kompakte Verlaufszeile für die Historie auf.

**Stärken:**
- ✅ sehr platzsparend
- ✅ Trenddarstellung auch in kleinen VIS-Flächen gut lesbar
- ✅ nennt direkt die größten Wachser pro Instanz

---

### `sampleInstance(instance)`

Das ist die zentrale Messfunktion.

#### Ablauf

1. Vorherigen Zustand der Instanz laden oder initialisieren.
2. Diagnosedaten per `sendToAsync(..., 'diag', {})` anfordern.
3. Fehler- oder Offlinefälle abfangen.
4. CPU-Differenz zum letzten Sample berechnen.
5. Baseline beim ersten gültigen Sample setzen.
6. Detail- und Summary-HTML zurückgeben.

#### CPU-Berechnung

```text
wallMs = now - prev.now
cpuMs  = (cpuUserMs + cpuSystemMs) - (prev.cpuUserMs + prev.cpuSystemMs)
cpuPct = (cpuMs / wallMs) * 100
```

> [!CAUTION]
> `cpuPct` ist hier als **Trendmetrik** zu lesen, nicht als 1:1-Abbild der System-CPU im Betriebssystem.

---

### `sample()`

Orchestriert den kompletten Messzyklus:

- paralleles Sampling aller Instanzen
- Aufbau der Verlaufszeile
- Trimmen der Historie auf 10 Minuten
- Zusammenbau des HTML-Blocks
- Schreiben in den Ziel-State

**Bewertung:**
- ✅ gute Parallelisierung mit `Promise.all`
- ✅ keine unnötige State-Aufblähung
- ✅ sauberer, übersichtlicher Ablauf

---

### `main()`

Initialisiert den Ziel-State, startet das erste Sample sofort und setzt anschließend den Intervalltimer.

Zusätzlich wird das Intervall mit `onStop()` sauber beendet.

> [!TIP]
> Das ist ein kleines, aber wichtiges Qualitätsmerkmal: Das Diagnoseskript leakt nicht selbst weiter, wenn es gestoppt wird.

---

## 🖥️ VIS-Ausgabe

### Struktur der HTML-Ausgabe

| Ebene | Inhalt |
|---|---|
| Kopfzeile | Aktualisierungszeit, Sampling-Intervall, Verlaufslänge |
| Detailbereich | Pro Instanz eine Tabelle der auffälligen Skripte |
| Verlaufsbereich | letzte Samples, neueste zuerst |

### Positive UI-Aspekte

- ✅ Monospace-Look passt zum Diagnose-Use-Case.
- ✅ Feste Höhe mit Scrollbereich ist in VIS praktisch.
- ✅ Subline trennt Metadaten sinnvoll von den Skriptdetails.
- ✅ Wachstumszeilen sind optisch schnell auffindbar.

### UI-Grenzen

| Thema | Auswirkung |
|---|---|
| viele Spalten | auf kleineren Widgets schnell eng |
| Farbe als Hauptsignal | für Accessibility nicht ideal |
| HTML als Endformat | gut für VIS, schlecht für Weiterverarbeitung |
| Top-N-Ansatz | kleinere Leaks können aus der Liste fallen |

---

## 📈 Interpretation der Metriken

### Spalten lesen

| Spalte | Bedeutung | Warnsignal |
|---|---|---|
| `total` | Gesamtzahl aktiver Ressourcen | globaler Auffälligkeitswert |
| `Δstart` | Wachstum seit Start | wichtigster Leak-Indikator |
| `tmo` | Timeouts | wiederholt erzeugte Timer |
| `intv` | Intervalle | klassischer `setInterval()`-Leak |
| `sched` | Schedules | doppelte Scheduler-Registrierung |
| `delayed` | verzögerte States | Rückstau oder fehlendes Abarbeiten |
| `state` | State-Subscriptions | mehrfaches `on()` |
| `wild` | Wildcard-Subscriptions | breite und teure Beobachtung |
| `file` | File-Subscriptions | Spezialfall, aber beobachtbar |
| `obj` | Objekt-Subscriptions | unnötige Objektbeobachtung |
| `msg` | Message-Handler | doppelte Handler-Registrierung |
| `logSub` | Log-Subscriptions | nicht entfernte Log-Abos |

### Typische Muster

#### 🟢 Unkritisch

- `Δstart` bleibt stabil.
- Peaks fallen wieder zurück.
- CPU steigt kurz, ohne dauerhaften Ressourcenanstieg.

#### 🟠 Verdächtig

- `Δstart` wächst in mehreren aufeinanderfolgenden Samples.
- `intervals`, `timeouts` oder `stateSubs` steigen monoton.
- CPU und Ressourcenanstieg korrelieren sichtbar.

#### 🔴 Stark verdächtig

- mehrere Ressourcentypen wachsen gleichzeitig
- derselbe Skriptname taucht immer wieder als Top-Grower auf
- RSS/Heap wachsen parallel mit

> [!WARNING]
> Besonders kritisch sind Muster, bei denen **`stateSubs` + `wildcardSubs` + `messageHandlers`** gemeinsam steigen. Das deutet oft auf fehlerhafte Wiederregistrierung hin.

---

## ✅ Stärken

### Fachlich

- 🌍 Instanzübergreifend, auch für Multi-Host-Szenarien geeignet
- 📉 Trendorientiert statt reiner Snapshot-Betrachtung
- 🧭 Gute Eingrenzung des verdächtigen Skripts
- 🖥️ Sofort in VIS verwendbar
- 🪶 Leichtgewichtig ohne zusätzliche Infrastruktur

### Technisch

- 🧼 guter, sauber lesbarer Code
- 🧱 klare Trennung zwischen Sammeln, Rendern und Zusammenfassen
- 🛑 sauberes Lifecycle-Handling mit `onStop()`
- 🛡️ HTML-Escaping vorhanden
- ✂️ History wird begrenzt und wächst nicht unendlich

---

## ⚠️ Schwachstellen

### 1. Abhängigkeit von `diag`

> [!CAUTION]
> Ohne passende Antwort auf `sendTo(..., 'diag', {})` ist die jeweilige Instanz praktisch nicht auswertbar.

Das Skript setzt voraus, dass jede Zielinstanz die benötigte Diagnoseschnittstelle bereitstellt.

---

### 2. Baseline nicht persistent

Die Baseline wird nur im RAM gehalten.

**Folge:**
- Nach Neustarts geht die Referenz verloren.
- Langfristige Vergleiche über Sessions hinweg fehlen.

---

### 3. `total` ist nur eine Heuristik

Die Summenmetrik ist nützlich, aber grob.

**Problem:**
- gleiche Gewichtung aller Ressourcentypen
- reale Performance-Relevanz wird nicht exakt abgebildet

---

### 4. CPU-Wert kann missverstanden werden

**Gefahr:**
- Nutzer lesen `cpuPct` als absolute Systemauslastung.
- Tatsächlich ist es eher eine instanzbezogene Delta-Metrik.

---

### 5. HTML und Daten sind gekoppelt

Das ist für VIS bequem, aber analytisch unflexibel.

| Nachteil | Effekt |
|---|---|
| keine JSON-Struktur | erschwerte Weiterverarbeitung |
| keine einfache Exportkette | schlechter für Grafana/InfluxDB o. Ä. |
| Layout = Daten | schwierigere Wiederverwendung |

---

## 🚀 Verbesserungen

### A. HTML **und** JSON ausgeben

> [!IMPORTANT]
> Das wäre der größte praktische Hebel für die nächste Evolutionsstufe.

Empfehlung:

- `0_userdata.0.cpu_check` → HTML für VIS
- `0_userdata.0.cpu_check_json` → strukturierte Rohdaten

**Vorteile:**
- bessere Debugbarkeit
- einfachere Langzeitarchivierung
- spätere Alarmierung oder Diagramme leichter möglich

---

### B. Gewichteten Leak-Score einführen

Beispielidee:

```text
score = 4*wildcardSubs + 3*intervals + 3*timeouts + 2*stateSubs + 2*messageHandlers + 1*logSubs
```

Damit würden besonders teure oder verdächtige Muster deutlicher priorisiert.

---

### C. Persistente oder rollierende Baseline

Mögliche Strategien:

- 💾 Baseline in separatem State speichern
- 🔄 Vergleich gegen den Stand vor 10 Minuten
- 📊 Median oder gleitender Durchschnitt über die letzten Samples

---

### D. Alarme und Schwellwerte

Sinnvolle Regeln wären zum Beispiel:

- `Δstart > 20`
- `intervals` wächst in 5 Samples nacheinander
- `cpuPct > 40` in 3 Intervallen

Dann könnte zusätzlich ein Alarm-State geschrieben oder ein Log-Eintrag erzeugt werden.

---

### E. Bessere VIS-UX

Konkrete Ideen:

- 📌 Sticky Header in Tabellen
- 🔃 Umschaltbare Sortierung (`total` / `Δstart`)
- 💬 Tooltips für Spaltenkürzel
- 📉 kleine Trendindikatoren oder Sparklines
- 🎨 kontraststärkere Ampellogik

---

## 🧪 Praxisleitfaden

### So nutzt man das Skript sinnvoll

1. Skript starten und mindestens einige Minuten laufen lassen.
2. Zuerst auf **`Δstart`** schauen, nicht nur auf `total`.
3. Prüfen, **welche** Ressourcentypen wachsen.
4. Verlauf lesen: Taucht derselbe Kandidat wiederholt auf?
5. Verdächtiges Skript gezielt im Code prüfen.

### Mapping Diagnose → wahrscheinliche Ursache

| Diagnosemuster | Typische Ursache im Zielskript |
|---|---|
| `intv` wächst | mehrfaches `setInterval()` ohne `clearInterval()` |
| `tmo` wächst | fortlaufend neue `setTimeout()`-Ketten |
| `state` wächst | `on()` wird wiederholt registriert |
| `wild` wächst | breit angelegte oder doppelte Wildcard-Subscriptions |
| `msg` wächst | Handler mehrfach gebunden |
| `logSub` wächst | Log-Subscription nicht sauber beendet |
| `delayed` wächst | aufgestaute `setStateDelayed()`-Operationen |

> [!TIP]
> In ioBroker sind Leaks oft keine „klassischen Speicherlecks“, sondern **vergessene Registrierungen**: also Timer, `on()`-Handler, Schedules oder Message-Handler, die immer wieder neu aufgebaut werden.

---

## 🏁 Gesamtbewertung

### Bewertungsmatrix

| Kriterium | Urteil |
|---|---|
| Lesbarkeit | 🟢 sehr gut |
| Wartbarkeit | 🟢 gut bis sehr gut |
| VIS-Tauglichkeit | 🟢 sehr gut |
| Diagnosewert | 🟢 hoch |
| Erweiterbarkeit | 🟢 gut |
| Langzeit-Monitoring | 🟡 mittel |
| Maschinenlesbarkeit | 🟠 eher gering |

> [!SUCCESS]
> **Empfehlenswert für die operative Leak-Suche in ioBroker-JavaScript-Instanzen.**
>
> Besonders stark ist die Kombination aus Detailansicht, `Δstart` und kompakter History. Für ein dauerhaftes Monitoring wäre eine zusätzliche JSON-Ausgabe der nächste logische Schritt.

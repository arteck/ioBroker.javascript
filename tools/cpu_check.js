/*
 * CPU-creep diagnostic for ioBroker.javascript  ?  HTML for VIS
 * =============================================================
 *
 * Drop this whole file into ONE NEW JavaScript script (on any javascript instance)
 * and start it. It polls EVERY instance in INSTANCES via the message bus (works across
 * hosts) and writes a ready-to-render HTML table into a state. Bind that state in a VIS
 * "Basic ? HTML" widget to watch which script grows over time (CPU-creep culprit).
 *
 * Layout:
 *   - Top: current per-script detail table for each instance.
 *   - Below: a rolling history of the LAST 10 MINUTES (one compact line per sample),
 *     newest first. Older entries are dropped, so the state stays small (no data flood).
 *   - Everything sits in a fixed-height, scrollable box.
 *
 * VIS setup:
 *   1. Start this script. It creates the state 0_userdata.0.cpu_check.
 *   2. In VIS add a "Basic ? HTML" widget.
 *   3. Set the widget's HTML attribute to a binding of that state:  {0_userdata.0.cpu_check}
 *   4. Size the widget; the inner box scrolls (adjust CONTAINER_HEIGHT to taste).
 *
 * Columns: total | ?start (growth since first sample) | tmo intv sched delayed | state wild file obj | msg logSub
 * A row highlighted red and rising ?start = accumulation (timer/subscription leak).
 */

// ---- config -----------------------------------------------------------------
const INSTANCES = ['javascript.0', 'javascript.1', 'javascript.2']; // all instances to watch
const INTERVAL_MS = 30000; // sampling interval
const HISTORY_MS = 10 * 60 * 1000; // keep the last 10 minutes of samples
const TOP_N = 20; // scripts to show per instance in the detail table
const TOP_GROWERS = 5; // growing scripts to name per instance in the history line
const CONTAINER_HEIGHT = 500; // px height of the scroll box – match your VIS widget
const STATE_ID = '0_userdata.0.cpu_check'; // full id ? state lives in the user-data tree
// -----------------------------------------------------------------------------

const stateByInstance = {}; // { instance: { baseline:{script:total}, prev:{now,cpuUserMs,cpuSystemMs} } }
const history = []; // [{ ts, line }] rolling 10-min window

function totalOf(s) {
    return (
        s.stateSubs +
        s.fileSubs +
        s.objectSubs +
        s.timeouts +
        s.intervals +
        s.schedules +
        s.delayedStates +
        s.messageHandlers +
        s.logSubs
    );
}

function esc(v) {
    return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function cpuStyle(pct) {
    return pct >= 50 ? 'color:#e53935;font-weight:bold;' : pct >= 20 ? 'color:#fb8c00;' : '';
}

// --- styling (inline so it renders standalone in the widget) ---
const CSS = {
    wrap: `font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.35;color:inherit;height:${CONTAINER_HEIGHT}px;overflow:auto;width:100%;`,
    h: 'margin:8px 0 2px;font-weight:bold;',
    sub: 'opacity:.75;margin:0 0 4px;',
    table: 'border-collapse:collapse;width:100%;margin-bottom:10px;',
    th: 'text-align:right;padding:1px 6px;border-bottom:1px solid rgba(128,128,128,.5);white-space:nowrap;',
    thL: 'text-align:left;padding:1px 6px;border-bottom:1px solid rgba(128,128,128,.5);',
    td: 'text-align:right;padding:1px 6px;white-space:nowrap;',
    tdL: 'text-align:left;padding:1px 6px;',
    grow: 'background:rgba(229,57,53,.18);',
    stale: 'opacity:.45;',
    histWrap: 'margin-top:6px;border-top:1px solid rgba(128,128,128,.5);padding-top:4px;',
    histLine: 'white-space:nowrap;padding:1px 0;',
};

function instanceDetail(instance, res, cpuLine, cpuPct) {
    const g = res.global;
    const st = stateByInstance[instance];

    const rows = Object.keys(res.perScript)
        .map(name => {
            const s = res.perScript[name];
            const total = totalOf(s);
            return { name, s, total, dStart: total - (st.baseline[name] ?? 0) };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, TOP_N);

    let ar = '';
    if (g.activeResources) {
        ar = Object.keys(g.activeResources)
            .sort((a, b) => g.activeResources[b] - g.activeResources[a])
            .map(k => `${esc(k)}=${g.activeResources[k]}`)
            .join(' &nbsp; ');
    }

    let html = `<div style="${CSS.h}">${esc(instance)} <span style="${cpuStyle(cpuPct)}">| ${esc(cpuLine)}</span></div>`;
    html += `<div style="${CSS.sub}">scripts: ${res.scriptCount} &nbsp;|&nbsp; rss ${g.rssMB}MB &nbsp; heap ${g.heapUsedMB}MB &nbsp;|&nbsp; subs state=${g.stateSubsTotal} wildcard=${g.wildcardSubsTotal} file=${g.fileSubsTotal} object=${g.objectSubsTotal}</div>`;
    if (ar) {
        html += `<div style="${CSS.sub}">activeResources: ${ar}</div>`;
    }
    html += `<table style="${CSS.table}"><thead><tr><th style="${CSS.thL}">script</th>`;
    for (const h of ['total', '?start', 'tmo', 'intv', 'sched', 'delayed', 'state', 'wild', 'file', 'obj', 'msg', 'logSub']) {
        html += `<th style="${CSS.th}">${h}</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const r of rows) {
        const s = r.s;
        const dTxt = (r.dStart > 0 ? '+' : '') + r.dStart;
        html += `<tr style="${r.dStart > 0 ? CSS.grow : ''}"><td style="${CSS.tdL}">${esc(r.name)}</td>`;
        for (const v of [
            r.total,
            dTxt,
            s.timeouts,
            s.intervals,
            s.schedules,
            s.delayedStates,
            s.stateSubs,
            s.wildcardSubs,
            s.fileSubs,
            s.objectSubs,
            s.messageHandlers,
            s.logSubs,
        ]) {
            html += `<td style="${CSS.td}">${v}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
}

function instanceSummary(instance, res, cpuPct) {
    const st = stateByInstance[instance];
    const growers = Object.keys(res.perScript)
        .map(name => ({ name, d: totalOf(res.perScript[name]) - (st.baseline[name] ?? 0) }))
        .filter(x => x.d > 0)
        .sort((a, b) => b.d - a.d)
        .slice(0, TOP_GROWERS);
    const grewTxt = growers.length
        ? '? ' + growers.map(x => `${esc(x.name)}(+${x.d})`).join(', ')
        : '–';
    return (
        `<b>${esc(instance)}</b> ` +
        `<span style="${cpuStyle(cpuPct)}">cpu ${cpuPct.toFixed(0)}%</span> ` +
        `rss ${res.global.rssMB}MB &nbsp; ${grewTxt}`
    );
}

async function sampleInstance(instance) {
    const st = stateByInstance[instance] || (stateByInstance[instance] = { baseline: null, prev: null });
    let res;
    try {
        res = await sendToAsync(instance, 'diag', {});
    } catch {
        return { detail: `<div style="${CSS.h} ${CSS.stale}">${esc(instance)} — keine Antwort (Instanz down / 'diag' nicht deployed)</div>`, summary: `<b>${esc(instance)}</b> <span style="${CSS.stale}">offline</span>` };
    }
    if (!res || !res.perScript) {
        return { detail: `<div style="${CSS.h} ${CSS.stale}">${esc(instance)} — ungültige Antwort ('diag' im Adapter vorhanden?)</div>`, summary: `<b>${esc(instance)}</b> <span style="${CSS.stale}">n/a</span>` };
    }

    const now = Date.now();
    const g = res.global;
    let cpuLine = 'cpu%: n/a (erstes Sample)';
    let cpuPct = 0;
    if (st.prev) {
        const wallMs = now - st.prev.now;
        const cpuMs = g.cpuUserMs + g.cpuSystemMs - (st.prev.cpuUserMs + st.prev.cpuSystemMs);
        cpuPct = wallMs > 0 ? (cpuMs / wallMs) * 100 : 0;
        cpuLine = `cpu%: ${cpuPct.toFixed(1)} (${cpuMs}ms CPU / ${wallMs}ms wall)`;
    }
    st.prev = { now, cpuUserMs: g.cpuUserMs, cpuSystemMs: g.cpuSystemMs };

    if (!st.baseline) {
        st.baseline = {};
        for (const name of Object.keys(res.perScript)) {
            st.baseline[name] = totalOf(res.perScript[name]);
        }
    }
    return { detail: instanceDetail(instance, res, cpuLine, cpuPct), summary: instanceSummary(instance, res, cpuPct) };
}

async function sample() {
    const now = Date.now();
    const results = await Promise.all(INSTANCES.map(sampleInstance));

    // append compact line(s) to history and trim to the last 10 minutes
    const t = new Date(now).toLocaleTimeString();
    history.push({ ts: now, line: `<div style="${CSS.histLine}">${t} &nbsp; ${results.map(r => r.summary).join(' &nbsp;·&nbsp; ')}</div>` });
    const cutoff = now - HISTORY_MS;
    while (history.length && history[0].ts < cutoff) {
        history.shift();
    }

    const detail = results.map(r => r.detail).join('');
    const hist = history
        .slice()
        .reverse()
        .map(h => h.line)
        .join('');

    const html =
        `<div style="${CSS.wrap}">` +
        `<div style="${CSS.sub}">cpu-diag &nbsp; aktualisiert: ${esc(new Date(now).toLocaleString())} &nbsp; (alle ${INTERVAL_MS / 1000}s, Verlauf ${HISTORY_MS / 60000} min)</div>` +
        detail +
        `<div style="${CSS.histWrap}"><div style="${CSS.h}">Verlauf (letzte ${HISTORY_MS / 60000} min, neueste zuerst)</div>${hist}</div>` +
        `</div>`;

    await setStateAsync(STATE_ID, html, true);
}

async function main() {
    await createStateAsync(STATE_ID, '', {
        name: 'CPU diag HTML',
        type: 'string',
        role: 'html',
        read: true,
        write: false,
    });
    log(`cpu-diag: HTML wird geschrieben nach State '${STATE_ID}'. Binding im VIS-HTML-Widget: {${STATE_ID}}`);
    await sample();
    const timer = setInterval(sample, INTERVAL_MS);
    onStop(() => clearInterval(timer), 1000);
}

void main();

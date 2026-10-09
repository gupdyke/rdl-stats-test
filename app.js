const $ = (id) => document.getElementById(id);
const out = $("out");
let catalog = { rdl: [] };
let news = null;          // parsed newsletter currently selected
// Each table sorts on its own: table id -> { key, desc }. "main"/"more" are the
// Division view's tables; the comparison tables have their own ids.
const sorts = {};
const resetViewSorts = () => { delete sorts.main; delete sorts.more; };
// Every table has Collapse in its top-left cell: it shrinks that table to its top row (and
// Expand brings it back). Keyed by table; a new pick (dropdowns, Search, Reset) expands them all.
const collapsed = new Set();
function collapseButton(key) {
  const b = el("button", { type: "button", className: "collapse" }, collapsed.has(key) ? "Expand" : "Collapse");
  b.onclick = () => { if (!collapsed.delete(key)) collapsed.add(key); render(); };
  return b;
}
const NAME = "__name";   // sort key for the Player/Team column (alphabetical)

// ---- column groups -------------------------------------------------------
const wl = (w, l) => (r) => (r[w] == null ? "" : `${r[w]}-${r[l]}`);
const pct = (k) => (r) => (r[k] == null ? "---" : (+r[k]).toFixed(3));   // 0.600, like the newsletter
const num = (k, d = 0) => (r) => (r[k] == null ? "" : (+r[k]).toFixed(d));
const GROUPS = {
  singles:  { title: "Singles", box: true, cols: [
    { h: "301", f: wl("s301_w", "s301_l"), k: "s301_w" },
    { h: "Win %", f: pct("s301_pct"), k: "s301_pct" },
    { h: "Cricket", f: wl("scr_w", "scr_l"), k: "scr_w" },
    { h: "Win %", f: pct("scr_pct"), k: "scr_pct" },
    { h: "Record", f: wl("s_w", "s_l"), k: "s_w" },
    { h: "Win %", f: pct("s_pct"), k: "s_pct" } ] },
  doubles:  { title: "Doubles", box: true, cols: [
    { h: "Cricket", f: wl("dcr_w", "dcr_l"), k: "dcr_w" },
    { h: "Win %", f: pct("dcr_pct"), k: "dcr_pct" },
    { h: "501", f: wl("d501_w", "d501_l"), k: "d501_w" },
    { h: "Win %", f: pct("d501_pct"), k: "d501_pct" },
    { h: "Record", f: wl("d_w", "d_l"), k: "d_w" },
    { h: "Win %", f: pct("d_pct"), k: "d_pct" } ] },
  overall:  { title: "Overall", box: true, cols: [
    { h: "Record", f: wl("t_w", "t_l"), k: "t_w" },
    { h: "Win %", f: pct("t_pct"), k: "t_pct" },
    { h: "Matches", f: num("matches"), k: "matches" },
    { h: "Games", f: num("gp"), k: "gp" } ] },
  allstar:  { title: "All-Star", box: true, cols: [
    { h: "Points", f: num("asp", 1), k: "asp" },
    { h: "Avg", f: num("asp_avg", 3), k: "asp_avg" } ] },
  tiebreak: { title: "Tiebreakers", box: true, cols: [
    { h: "W-L", f: wl("tb_w", "tb_l"), k: "tb_w" } ] },
};
// Team rows end with the team's standings (match record and points, from Pg2),
// always shown, as the first group (right after the name). They have no matches-played count.
// Sorting by record breaks ties on standings points, as the league does.
const STANDINGS = { title: "Standings", box: true, cols: [
  { h: "Record", f: wl("m_w", "m_l"), k: "m_w", then: "m_pts" },
  { h: "Points", f: num("m_pts"), k: "m_pts" } ] };
// Team totals start in standings order: best record first, ties on points.
const BY_STANDINGS = { key: "m_w", desc: true };

const el = (tag, attrs = {}, text) => {
  const e = Object.assign(document.createElement(tag), attrs);
  if (text != null) e.textContent = text;
  return e;
};
function fill(select, items, keepValue) {
  const prev = select.value;
  select.replaceChildren(...items.map(([v, t]) => el("option", { value: v }, t)));
  if (keepValue && items.some(([v]) => v === prev)) select.value = prev;
}
// The public site (GitHub Pages, RDL only) has no server: it reads pre-built
// JSON made by build_public.py instead of the API.
const PUBLIC = window.STATS_PUBLIC === true;
function publicURL(url) {
  const u = new URL(url, location.origin);
  if (u.pathname === "/api/catalog") return "data/catalog.json";
  if (u.pathname === "/api/rdl") return `data/rdl/${u.searchParams.get("file").replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
  throw new Error("Not available on the public site.");
}
async function getJSON(url) {
  const r = await fetch(PUBLIC ? `${publicURL(url)}?v=${window.STATS_VERSION}` : url);   // this deploy's data, not a cached copy
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
// A phone's home-screen app picks up where it left off instead of reloading, and may
// reuse its cached page for 10 minutes. So on opening or coming back, ask for this
// deploy's version.json; if a newer deploy is out, load it (the ?v= gets past the cache;
// not reloading when the URL already has it stops a loop while the new deploy spreads).
async function reloadIfNewDeploy() {
  if (!PUBLIC || document.visibilityState !== "visible") return;
  try {
    const { v } = await (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (v && v !== window.STATS_VERSION && new URLSearchParams(location.search).get("v") !== v)
      location.replace(`${location.pathname}?v=${v}`);
  } catch { /* offline: keep what's showing */ }
}
document.addEventListener("visibilitychange", reloadIfNewDeploy);
window.addEventListener("pageshow", reloadIfNewDeploy);
function message(text, cls = "empty") { out.replaceChildren(el("p", { className: cls }, text)); }

// ---- table ---------------------------------------------------------------
// Boxed groups: left/right borders on a group's first and last columns.
const edge = (g, c) => (!g.box ? "" : ["bx", c === g.cols[0] && "bl", c === g.cols[g.cols.length - 1] && "br"].filter(Boolean).join(" "));
function statTable(rows, { id, nameHeader, name, total, removeFrom, addable, defaultSort }) {
  const teamRows = nameHeader === "Team";
  const shown = [...document.querySelectorAll(".groups input:checked")].map((c) => c.value);
  const groups = [...(teamRows && shown.includes("standings") ? [STANDINGS] : []),   // Standings: team rows only
    ...shown.filter((v) => GROUPS[v]).map((v) => GROUPS[v])
      .map((g) => ({ ...g, cols: g.cols.filter((c) => !teamRows || c.k !== "matches") }))];
  // The default sort only applies while its column is showing (no standings order with Standings off).
  const shownDefault = defaultSort && groups.some((g) => g.cols.some((c) => c.k === defaultSort.key)) ? defaultSort : null;
  const sort = sorts[id] || shownDefault || { key: null, desc: true };
  if (sort.key === NAME) {
    const cmp = nameHeader === "Player" ? byPlayerId : (a, b) => name(a).localeCompare(name(b));
    rows = [...rows].sort((a, b) => cmp(a, b) * (sort.desc ? -1 : 1));
  } else if (sort.key) {
    const then = groups.flatMap((g) => g.cols).find((c) => c.k === sort.key)?.then;
    const diff = (a, b, k) => (a[k] ?? -1) - (b[k] ?? -1);
    rows = [...rows].sort((a, b) => (diff(a, b, sort.key) || (then ? diff(a, b, then) : 0)) * (sort.desc ? -1 : 1));
  }
  const top = el("tr"), sub = el("tr");
  // Every sortable heading shows an arrow: ▼/▲ on the column the table is sorted by, a faint ⇅ on the rest.
  const heading = (text, key) => {
    const th = el("th", {}, text);
    th.append(el("span", { className: sort.key === key ? "arrow" : "arrow idle" }, sort.key !== key ? " ⇅" : sort.desc ? " ▼" : " ▲"));
    return th;
  };
  const corner = el("th", { className: "grp box corner" });   // the name column is boxed too
  corner.append(collapseButton(id));
  top.append(corner);
  const nameTh = Object.assign(heading(nameHeader, NAME), { className: "name bl br", title: nameHeader === "Player" ? "Sort by player ID" : "Sort A-Z" });
  nameTh.onclick = () => { sorts[id] = { key: NAME, desc: sort.key === NAME ? !sort.desc : false }; render(); };
  sub.append(nameTh);
  for (const g of groups) {
    top.append(el("th", { className: g.box ? "grp box" : "grp", colSpan: g.cols.length }, g.title));
    for (const c of g.cols) {
      const th = Object.assign(heading(c.h, c.k), { title: "Sort", className: edge(g, c) });
      th.onclick = () => { sorts[id] = { key: c.k, desc: sort.key === c.k ? !sort.desc : true }; render(); };
      sub.append(th);
    }
  }
  const line = (r, label, cls) => {
    const inCmp = addable && r.key != null && (r.kind === "team" ? picked.teams : picked.players).includes(r.key);
    const tr = el("tr", { className: [cls, inCmp && "picked"].filter(Boolean).join(" ") });   // in the comparison: highlighted
    const td = el("td", { className: "name bx bl br" });
    // The name sits in a box of its own: on a phone, where it wraps, its second line lines up on the right (style.css).
    const box = td.appendChild(el("div", { className: "namebox" }));
    if (removeFrom) box.append(removeButton(removeFrom, r.key, r.label));   // comparison tables
    else if (addable && r.key != null) box.append(addButton(r.kind === "team" ? picked.teams : picked.players, r.key, r.label));
    box.append(el("span", {}, label));
    tr.append(td);
    for (const g of groups) for (const c of g.cols) tr.append(el("td", { className: edge(g, c) }, c.f(r)));
    return tr;
  };
  const tbody = el("tbody");
  rows.forEach((r) => tbody.append(line(r, name(r))));
  if (total) tbody.append(line(total, "Team total", "total"));
  const table = el("table", { className: "stats" });
  table.append(el("thead"));
  if (collapsed.has(id)) table.tHead.append(top);   // just the group headings and Expand
  else { table.tHead.append(top, sub); table.append(tbody); }
  const wrap = el("div", { className: "scroll" });
  wrap.append(table);
  return wrap;
}

// + on a row in the Division view puts that team or player straight into the comparison.
// Once it's in, the + turns into a − that takes it back out.
function addButton(list, key, label) {
  const added = list.includes(key);
  const b = el("button", { type: "button", className: added ? "cmp in" : "cmp",
    title: added ? "Remove from comparison" : "Add to comparison" }, added ? "−" : "+");
  b.setAttribute("aria-label", `${added ? "Remove" : "Add"} ${label} ${added ? "from" : "to"} comparison`);
  b.onclick = () => { toggle(list, key); render(); };
  return b;
}
const toggle = (list, key) => (list.includes(key) ? list.splice(list.indexOf(key), 1) : list.push(key));
// × on a comparison row takes that team or player out of the comparison.
function removeButton(list, key, label) {
  const b = el("button", { type: "button", className: "cmp", title: "Remove from comparison" }, "×");
  b.setAttribute("aria-label", `Remove ${label} from comparison`);
  b.onclick = () => { list.splice(list.indexOf(key), 1); render(); };
  return b;
}

// ---- RDL mode ------------------------------------------------------------
// Division "" = All divisions (the whole league).
const teamsOf = () => (!news ? [] : $("division").value ? news.divisions[$("division").value] || [] : allTeams());
const playerKey = (t, p) => `${t.code}:${p.number}`;   // numbers repeat across divisions
const playerLabel = (t, p) => `${p.name} (${t.code[0]}${p.number})`;   // "Updyke, Gerald (F74)": the player ID
// Player rows carry the team so the Player column can sort by ID: division, then number (A10 ... F74).
const playerRow = (t, p) => ({ ...p, label: playerLabel(t, p), div: t.code[0], key: p.name, kind: "player" });
const teamRow = (t) => ({ ...t.totals, label: `${t.code} - ${t.name}`, key: t.code, kind: "team" });
const byPlayerId = (a, b) => a.div.localeCompare(b.div) || a.number - b.number;

// ---- saved view: Season, Week, Division and Team, so the page opens where it was left ----
// Saved in this browser when those dropdowns change (a search jumping to another
// division or team doesn't count). The team is saved by name: codes change between seasons. If a newer week has come out since, the page opens on it.
const SAVED = "rdl-stats-view";
const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVED)) || {}; } catch { return {}; } })();
function saveView() {
  Object.assign(saved, { week: $("newsletter").value, division: $("division").value,
    team: allTeams().find((t) => t.code === $("team").value)?.name || "",
    latest: catalog.rdl[catalog.rdl.length - 1]?.file });
  try { localStorage.setItem(SAVED, JSON.stringify(saved)); } catch {}
}
// The saved team's code if it's in the division showing, else "" (All teams).
const homeTeam = () => (saved.team && teamsOf().find((t) => t.name === saved.team)?.code) || "";
// The saved division if this week has it, else the first one.
function homeDivision() {
  const ok = "division" in saved && [...$("division").options].some((o) => o.value === saved.division);
  return ok ? saved.division : $("division").options[1]?.value || "";
}

// Season (from the file name: Sp23, Fa26, ...) then Week. The catalog comes
// in chronological order: weeks list oldest first, seasons newest first.
const seasonOf = (n) => n.season || "Other";
function fillWeeks() {
  const prevWeek = catalog.rdl.find((n) => n.file === $("newsletter").value)?.week;
  const weeks = catalog.rdl.filter((n) => seasonOf(n) === $("season").value);
  fill($("newsletter"), weeks.map((n) => [n.file,
    n.final ? "End of season" : n.week != null ? `Week ${n.week}` : n.file]));
  const same = weeks.find((n) => n.week != null && n.week === prevWeek);   // keep the week across seasons
  $("newsletter").value = same ? same.file : weeks[weeks.length - 1]?.file || "";
}

async function loadNewsletter() {
  const prevName = selectedPlayer()?.p.name;   // follow the person by name, not team/number
  news = null;
  if (!$("newsletter").value) return message("No RDL newsletters in the data folder yet.");
  message("Loading…");
  try { news = await getJSON(`/api/rdl?file=${encodeURIComponent($("newsletter").value)}`); }
  catch (e) { return message(e.message, "error"); }
  const divs = Object.keys(news.divisions).sort().map((d) => [d, `${d} Division`]);
  const first = !$("division").options.length;
  fill($("division"), [["", "All divisions"], ...divs], true);
  fillTrophies();
  if (first) $("division").value = homeDivision();
  fillTeams();
  if (first && homeTeam()) { $("team").value = homeTeam(); fillPlayers(); }
  if (prevName) followPlayer(prevName);
}

// The Browse player as {t, p}, or null.
function selectedPlayer() {
  if (!news || !$("player").value) return null;
  const [code, num] = $("player").value.split(":");
  const t = allTeams().find((t) => t.code === code);
  const p = t?.players.find((p) => String(p.number) === num);
  return p ? { t, p } : null;
}
// After a season/week change: select the same person wherever they are now.
// Team codes and numbers change between seasons, so match on the name.
function followPlayer(name) {
  const hit = allTeams().flatMap((t) => t.players.map((p) => ({ t, p }))).find(({ p }) => p.name === name);
  if (hit) return showPlayer(hit.t, hit.p);
  $("team").value = "";
  fillPlayers();
  $("player").value = "none";
  render();
  out.prepend(el("p", { className: "empty" },
    `${name} isn't in ${$("season").value} ${$("newsletter").selectedOptions[0]?.text || ""}.`));
}
function fillTeams() {
  fill($("team"), [["", "All teams"], ...teamsOf().map((t) => [t.code, `${t.code} - ${t.name}`])], true);
  fillPlayers();
}
function fillPlayers() {
  const teams = $("team").value ? teamsOf().filter((t) => t.code === $("team").value) : teamsOf();
  const players = teams.flatMap((t) => t.players.map((p) => [playerKey(t, p), playerLabel(t, p)]))
    .sort((a, b) => a[1].localeCompare(b[1]));
  const first = !$("player").options.length;
  fill($("player"), [["none", "None"], ["", "All players"], ...players], !first);   // None (no player rows) is the default
  render();
}

function renderStandings() {
  if (!news) return;
  const teams = teamsOf();
  const team = teams.find((t) => t.code === $("team").value);
  const withLabels = (ts) => ts.flatMap((t) => t.players.map((p) => playerRow(t, p)));
  const [code, num] = $("player").value.split(":");
  const owner = num && teams.find((t) => t.code === code);
  const p = owner && owner.players.find((p) => String(p.number) === num);
  const noPlayers = $("player").value === "none";   // Player: None = team rows only
  let view, more = [];   // more = the division's players list, hidden while comparing
  if (p) {
    view = [el("h2", {}, `${p.name} — ${owner.code} - ${owner.name}`),
      statTable(withLabels([{ ...owner, players: [p] }]), { id: "main", nameHeader: "Player", name: (r) => r.label, addable: true })];
  } else if (team && noPlayers) {
    view = [el("h2", {}, `${team.code} - ${team.name}`),
      statTable([teamRow(team)], { id: "main", nameHeader: "Team", name: (r) => r.label, addable: true })];
  } else if (team) {   // its players: the heading carries the team's match record, "F7 - Nein Mark (3-3)"
    const record = wl("m_w", "m_l")(team.totals);
    view = [el("h2", {}, `${team.code} - ${team.name}${record && ` (${record})`}`),
      statTable(withLabels([team]), { id: "main", nameHeader: "Player", name: (r) => r.label, total: teamRow(team), addable: true })];
  } else if (!$("division").value && noPlayers) {
    view = [el("h2", {}, `All divisions — Team totals`),
      statTable(teams.map(teamRow), { id: "main", nameHeader: "Team", name: (r) => r.label, addable: true, defaultSort: BY_STANDINGS })];
  } else if (!$("division").value) {
    const rows = withLabels(teams);
    view = [el("h2", {}, `All divisions — ${rows.length} players`),
      statTable(rows, { id: "main", nameHeader: "Player", name: (r) => r.label, addable: true })];
  } else {
    const players = withLabels(teams);
    view = [el("h2", {}, `${$("division").value} Division — Team totals`),
      statTable(teams.map(teamRow), { id: "main", nameHeader: "Team", name: (r) => r.label, addable: true, defaultSort: BY_STANDINGS })];
    if (!noPlayers) more = [el("h2", {}, `${$("division").value} Division — ${players.length} players`),
      statTable(players, { id: "more", nameHeader: "Player", name: (r) => r.label, addable: true })];
  }
  // While comparing: the table being picked from stays put, the comparison goes right below it,
  // and the division's long players list is left out. A team or player picked in the dropdowns
  // that's already in the comparison isn't shown twice.
  const comparison = compareView();
  if (!comparison.length) return out.replaceChildren(...view, ...more);
  const inComparison = p ? picked.players.includes(p.name) : team ? picked.teams.includes(team.code) : false;
  out.replaceChildren(...(inComparison ? [] : [...view, el("hr", { className: "cmp-end" })]), ...comparison);
}

// ---- Trophy darts (Pg3): one category, every division or the one picked ------
// Each division's entry is the lines from the newsletter: the result first, then the
// player(s) and team. Lines split mid-thought are put back together: "Ton-12 (twice! -"
// + "8/19/26 & 9/16/26)", and "Chuck Ginger &" + "Roy Lee Lindsey".
function trophyLines(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const open = prev && (prev.split("(").length > prev.split(")").length || prev.endsWith("&") || l.startsWith("&"));
    if (open) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}
function fillTrophies() {
  const cats = (news?.trophies || []).map((b) => [b.category, b.category]);
  fill($("trophy"), [["*", "All"], ...cats], true);   // All = every category
}
// rows: [[first column, lines]]; lines[0] is the result, the rest the player(s) and team.
function trophyTable(title, firstHeader, rows, key) {
  return boxTable(title, [firstHeader, "Result", "Player and team"], rows.map(([first, lines]) => {
    const [result = "", ...who] = trophyLines(lines);
    return [first, /^\(none reported\)$/i.test(result) ? "None reported" : result, who.join("\n")];
  }), { lines: [0, 2], key });
}
// One category: every division (or the one picked). All: with a division, every
// category in one table; with All divisions, a table per category.
function trophyView(blocks) {
  const div = $("division").value;
  const where = div ? `${div} Division` : "All divisions";
  if (blocks.length > 1 && div) {
    return [el("h2", {}, `Trophy darts — ${where}`),
      trophyTable(`${div} Division`, "Category", blocks.map((b) => [b.category.replace("High Out - ", "High Out -\n"), b.divisions[div] || []]), `trophy:${div}`)];   // two lines: "High Out -" / "301/501/1001"
  }
  return [el("h2", {}, `Trophy darts — ${blocks.length > 1 ? "all categories, " : ""}${where}`),
    ...blocks.map((b) => trophyTable(b.category, "Division",
      Object.keys(b.divisions).filter((d) => !div || d === div).map((d) => [`${d} Division`, b.divisions[d]])))];
}

function trophyPage() {
  const blocks = $("trophy").value === "*" ? news.trophies || []
    : (news.trophies || []).filter((b) => b.category === $("trophy").value);
  return blocks.length ? trophyView(blocks) : [el("p", { className: "empty" }, "No trophy darts in this newsletter.")];
}

// ---- Leader boards (Pg6-9), Hot Darts (Pg3), Predictions (Pg5) -----------------
// A table drawn like the Standings tables: the top row is Collapse (over the frozen columns)
// and the title (over the rest); then two boxes, the first `split` columns (the names) and
// the rest. numeric: right-aligned columns; lines: columns that keep their line breaks;
// freeze: how many columns on the left stay put while the rest scroll sideways (1 or 2);
// key: which table this is, for Collapse.
function boxTable(title, headers, rows, { split = 1, numeric = [], lines = [], freeze = 1, key = title } = {}) {
  const n = headers.length;
  const cls = (i) => [numeric.includes(i) ? "" : "name", lines.includes(i) && "lines", "bx",
    i < freeze && `frz frz${i}`, freeze === 2 && i === 0 && "rank",
    (i === 0 || i === split) && "bl", (i === split - 1 || i === n - 1) && "br"].filter(Boolean).join(" ");
  const top = el("tr"), sub = el("tr");
  const corner = el("th", { className: "grp box corner frz frz0", colSpan: freeze });
  corner.append(collapseButton(key));
  top.append(corner, el("th", { className: "grp box", colSpan: n - freeze }, title));
  headers.forEach((h, i) => sub.append(el("th", { className: cls(i) }, h)));
  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    r.forEach((v, i) => { const td = el("td", { className: cls(i) }); td.append(v); tr.append(td); });   // text or a link
    tbody.append(tr);
  }
  const table = el("table", { className: "stats plain" });
  table.append(el("thead"));
  if (collapsed.has(key)) table.tHead.append(top);
  else { table.tHead.append(top, sub); table.append(tbody); }
  const wrap = el("div", { className: "scroll" });
  wrap.append(table);
  return wrap;
}
const divisionsShown = (divs) => divs.filter((d) => !$("division").value || d === $("division").value).sort();
const where = () => ($("division").value ? `${$("division").value} Division` : "All divisions");

// Leader boards: the newsletter's three lists, shown together for each division: rank
// (blank = tied with the one above), player, team, and its three numbers. Win % and
// averages to 3 places, like everywhere else. (The end-of-season Doubles list is left out.)
// Board (next to Division) picks one list, or All.
const LEADER_BOARDS = [["Singles", "Singles Win Percentage"], ["Singles + Doubles", "Singles + Doubles Win Percentage"],
  ["All-Star", "All-Star Point Average (ASP)"]];
function leadersView() {
  const boards = LEADER_BOARDS.filter(([key]) => $("board").value === "*" || key === $("board").value)
    .map(([key, title]) => ({ ...(news.leaders || []).find((x) => x.board === key), title }))
    .filter((b) => b.divisions);
  if (!boards.length) return [el("p", { className: "empty" }, "No leader boards in this newsletter.")];
  const fmt = (v, col) => (typeof v === "number" && /%|Ave/.test(col) ? v.toFixed(3) : v ?? "");
  const table = (b, d) => {
    let prev;
    const rows = (b.divisions[d] || []).map((r) => {
      const rank = r.rank === prev ? "" : r.rank ?? "";
      prev = r.rank;
      return [String(rank), r.name, r.team.replace(/^([A-H]\d+)\/\s*/, "$1 - "), ...r.stats.map((v, i) => String(fmt(v, b.columns[i])))];
    });
    return boxTable(b.title, ["#", "Player", "Team", ...b.columns], rows, { split: 3, numeric: [0, 3, 4, 5], freeze: 2, key: `leaders:${d}:${b.title}` });
  };
  const divs = divisionsShown([...new Set(boards.flatMap((b) => Object.keys(b.divisions)))]);
  return [el("h2", {}, `Leader boards — ${where()} ${boards[0].note}`.trim()),
    ...divs.flatMap((d) => {
      const row = el("div", { className: "boards" });   // side by side when there's room
      row.append(...boards.map((b) => table(b, d)));
      return [el("h3", {}, `${d} Division`), row];
    })];
}

// Hot Darts: each division's list in the newsletter's order.
function hotView() {
  const hot = news.hot_darts || [];
  if (!hot.length) return [el("p", { className: "empty" }, "No Hot Darts in this newsletter.")];
  return [el("h2", {}, `Hot Darts — ${where()}`),
    ...divisionsShown([...new Set(hot.map((h) => h.division))]).map((d) =>
      boxTable(`${d} Division`, ["Player", "Team", "Hot dart"],
        hot.filter((h) => h.division === d).map((h) => [h.name, h.team, h.dart]), { split: 2, key: `hot:${d}` }))];
}

// Schedule: who plays whom in the week picked in Week (next to Division; 1-14). It comes from
// the season's grid in its Week 2 newsletter, or else that week's own newsletter (Pg5
// "THIS WEEK'S MATCHES"). Each location links to the bar's address on Google Maps.
const loaded = {};   // newsletter file -> its JSON (a promise), for the schedule's other weeks
const fetchNews = (file) => (loaded[file] ??= getJSON(`/api/rdl?file=${encodeURIComponent(file)}`));
const seasonFiles = () => catalog.rdl.filter((n) => seasonOf(n) === $("season").value);
let schedFor = null;   // the newsletter the Week dropdown was last set from
async function scheduleView() {
  const grid = await (async () => {
    const wk2 = seasonFiles().find((n) => n.week === 2);
    return wk2 ? (await fetchNews(wk2.file)).season_schedule || [] : [];
  })();
  if (schedFor !== $("newsletter").value) {   // a new week picked up top: open its schedule
    schedFor = $("newsletter").value;
    const n = catalog.rdl.find((x) => x.file === schedFor);
    fill($("schedweek"), Array.from({ length: 14 }, (_, i) => {
      const g = grid.find((w) => w.week === i + 1);
      return [String(i + 1), g?.date ? `Week ${i + 1} (${shortDate(g.date)})` : `Week ${i + 1}`];
    }));
    $("schedweek").value = String(n?.final ? 14 : n?.week || 1);
  }
  const week = +$("schedweek").value;
  let s = grid.find((w) => w.week === week);
  if (!s) {   // no grid: that week's own newsletter, if there is one
    const n = seasonFiles().find((x) => x.week === week);
    const own = n && (await fetchNews(n.file)).schedule;
    if (own) s = { week, divisions: own.divisions };
  }
  if (!s) return [el("p", { className: "empty" }, `No schedule for week ${week} in this season's newsletters.`)];
  const label = (code) => {
    const t = allTeams().find((x) => x.code === code);
    return t ? `${t.code} - ${t.name}` : code;   // a name that didn't match stays as printed
  };
  return [el("h2", {}, `Schedule — Week ${week}${s.date ? ` (${shortDate(s.date)})` : ""} — ${where()}`),
    ...divisionsShown(Object.keys(s.divisions)).map((d) => {
      const e = s.divisions[d];
      const rows = [...e.matches.map((m) => [label(m.away), label(m.home),
          m.unclear ? "Home team unclear in the newsletter" : locationCell(m.where)]),
        ...e.byes.map((b) => [label(b), "Bye", ""])];
      return boxTable(`${d} Division`, ["Away", "Home", "Location"], rows, { split: 2, key: `schedule:${d}` });
    })];
}
const shortDate = (iso) => new Date(`${iso}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// A location as printed ("Upper Deck 13+15"), with the bar's address under it as a Google Maps
// link, ONLY for the locations Jerry approved for that season (PLACES). Anything else (a past
// season, a new or misspelled location) stays plain text: a wrong link costs credibility, so
// nothing is guessed. To add a season or a bar, get Jerry's OK on the exact location and address.
// Keys: the location as printed in the season's schedule grid, lowercase, board numbers dropped.
const PLACES = {
  Fa26: {   // approved 2026-10-05; addresses from the Sp26 banquet "WHERE WE PLAY" list unless noted
    "american legion fv": ["American Legion Fuquay-Varina", "6400 Johnson Pond Road, Fuquay-Varina"],
    "backstage pub": ["Backstage Pub", "401 Ashville Avenue, Cary"],
    "benny's billiards": ["Benny's Billiards", "932 NE Maynard Road, Cary"],
    "brass tap": ["Brass Tap & Billiards", "3316 Capital Boulevard, Raleigh"],
    "break time billiards": ["Break Time Billiards", "6442 Tryon Road, Cary"],
    "buffalo bros. capital blvd.": ["Buffalo Brothers - Capital Blvd", "3111 Capital Blvd, Raleigh"],
    "cleveland dh garner": ["Cleveland Draft House - Garner", "6101 NC Highway 42 West, Garner"],
    "d's bottle shop": ["D's Bottle Shop", "13200 Falls of Neuse Rd, Suite 115, Raleigh"],
    "dugout tavern": ["Dugout Tavern", "1413 Kelly Road, Apex"],
    "high park": ["High Park Bar & Grille", "625 E. Whitaker Mill Road, Raleigh"],
    "hot shots": ["Hot Shots Billiards & Pub", "107 Edinburgh South Drive, Cary"],
    "lonerider wake forest": ["Lonerider Wake Forest", "1839 South Main Street, Suite 600, Wake Forest"],
    "mac's tavern": ["Mac's Tavern", "1014 Ryan Road, Cary"],
    "mackey's pub": ["Mackey's Pub", "2101 South Main Street, Wake Forest"],
    "main street taps": ["Main Street Taps", "Holly Springs"],   // Jerry: Two Time's bar; no street known
    "main street tavern": ["Main Street Tavern", "411 South Main Street, Rolesville"],
    "mulligans arcade": ["Mulligans Arcade and Tavern", "176 Bratton Drive, Garner"],
    "natural science": ["Natural Science", "2409 Crabtree Boulevard, Raleigh"],
    "pickled onion #2": ["The Pickled Onion #2", "8511 Cantilever Way, Raleigh"],
    "rally point sport grill": ["Rally Point Sport Grill", "1837 N. Harrison Ave., Cary"],
    "scooters": ["Scooters Bar & Grill", "1911 Sego Ct, Raleigh, NC 27616"],   // Jerry
    "sharky's place": ["Sharky's Place", "5800 Duraleigh Road, Raleigh"],
    "snooker's": ["Snooker's", "3520 Wade Avenue, Raleigh"],
    "taproom knightdate": ["The Taproom - Knightdale", "861 Old Knight Rd, Suite 104, Knightdale"],   // sic
    "the flying saucer": ["The Flying Saucer", "328 West Morgan Street, Raleigh"],
    "upper deck": ["The Upper Deck", "329 N. Harrison Avenue, Cary"],
  },
};
const placeKey = (where) => where.toLowerCase().replace(/\d+\s*[+&]\s*\d+/g, " ").replace(/\s+/g, " ").trim();
function locationCell(where) {
  const hit = PLACES[$("season").value]?.[placeKey(where)];
  if (!hit) return where;
  const [name, address] = hit;
  const a = el("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}${/\bNC\b/.test(address) ? "" : ", NC"}`)}`,
    target: "_blank", rel: "noopener" }, address);
  const cell = document.createDocumentFragment();
  cell.append(where, el("br"), a);
  return cell;
}

// Predictions, split by division: each division's match write-ups ("Match #2:  (F Div.) ...")
// and its picks for the rest of the week ("F Division: Two Time 14, ..."), labels in bold.
// The opening remarks aren't about one division, so they're left out.
function predictionsView() {
  const ps = news.predictions || [];
  if (!ps.length) return [el("p", { className: "empty" }, "No predictions in this newsletter.")];
  const para = (t, label) => {
    const m = t.match(/^((?:Match(?:es)?\b[^:]*|[A-H] Division):)\s*(.*)$/);
    const p = el("p", { className: "prediction" });
    if (label) p.append(el("b", {}, label), ` ${m ? m[2] : t}`);
    else if (m) p.append(el("b", {}, m[1]), ` ${m[2]}`);
    else p.textContent = t;
    return p;
  };
  const divOf = (t) => t.match(/\(([A-H]) Div[^)]*\)/)?.[1] || t.match(/^([A-H]) Division:/)?.[1];
  const divs = divisionsShown([...new Set(ps.map(divOf).filter(Boolean))]);
  return [el("h2", {}, `Predictions for the week — ${where()}`),
    ...divs.flatMap((d) => [el("h3", {}, `${d} Division`),
      ...ps.filter((t) => divOf(t) === d).map((t) => (/^[A-H] Division:/.test(t) ? para(t, "Other matches:") : para(t)))])];
}

// ---- RDL compare: teams and players added with + -------------------------------
// Search row: Clear takes everything out of the comparison and goes back to the default view.
// (A + on a search result, or on a Division view row, adds one.)
function clearPicked() {
  picked.teams.length = picked.players.length = 0;
  resetView();
}
// Teams are keyed by code, players by name (so they carry across seasons and weeks).
const picked = { teams: [], players: [] };   // keys, in the order added
const allTeams = () => Object.keys(news?.divisions || {}).sort().flatMap((d) => news.divisions[d]);

function compareView() {
  const parts = [];
  const section = (kind, list, found) => {
    const head = el("h2", { className: "cmp-head" }, found.length ? found.map((r) => r.label).join(", ") : `No ${kind}s in this week`);
    const clear = el("button", { type: "button" }, "Clear");
    clear.onclick = () => { list.length = 0; render(); };
    head.append(clear);
    parts.push(head);
    const missing = list.filter((k) => !found.some((r) => r.key === k));
    if (missing.length) {   // added in another week, not in this one
      const chips = el("div", { className: "chips" });
      chips.append(...missing.map((k) => {
        const chip = el("span", { className: "chip missing" }, `${k} (not in this week)`);
        const x = el("button", { type: "button", title: "Remove" }, "×");
        x.onclick = () => { list.splice(list.indexOf(k), 1); render(); };
        chip.append(x);
        return chip;
      }));
      parts.push(chips);
    }
  };
  if (picked.teams.length) {
    const ts = picked.teams.map((k) => allTeams().find((t) => t.code === k)).filter(Boolean);
    section("team", picked.teams, ts.map(teamRow));
    if (ts.length) {
      // All the compared teams' players in one table, so they sort against each other.
      const players = ts.flatMap((t) => t.players.map((p) => playerRow(t, p)));
      const names = ts.map((t) => `${t.code} - ${t.name}`);
      const which = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
      parts.push(statTable(ts.map(teamRow), { id: "cmp-teams", nameHeader: "Team", name: (r) => r.label, removeFrom: picked.teams }),
        el("h2", {}, `Players on ${which} — ${players.length}`),
        statTable(players, { id: "cmp-team-players", nameHeader: "Player", name: (r) => r.label, addable: true }));   // + adds a player too
    }
  }
  if (picked.players.length) {
    const all = allTeams().flatMap((t) => t.players.map((p) => playerRow(t, p)));
    const ps = picked.players.map((k) => all.find((r) => r.key === k)).filter(Boolean);
    section("player", picked.players, ps);
    if (ps.length) parts.push(statTable(ps, { id: "cmp-players", nameHeader: "Player", name: (r) => r.label, removeFrom: picked.players }));
  }
  return parts;
}

// ---- RDL search: players and teams, any part of a name, either order ---------
// Each hit is {label, pick, list, key}. Picking jumps there; its + adds it to the comparison
// (list, key). Either empties the box.
const words = (q) => q.toLowerCase().split(/[\s,]+/).filter(Boolean);
function searchPlayers(q) {
  const ws = words(q);
  if (!ws.length || !news) return [];
  return allTeams().flatMap((t) => t.players.map((p) => ({ t, p })))
    .filter(({ p }) => ws.every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => a.p.name.localeCompare(b.p.name))
    .slice(0, 30)
    .map(({ t, p }) => ({ label: playerLabel(t, p), pick: () => pickPlayer(t, p), list: picked.players, key: p.name }));
}
function searchTeams(q) {   // matches the ID or the name: "f7", "nein", "dart"
  const ws = words(q);
  if (!ws.length || !news) return [];
  return allTeams().map((t) => ({ label: `${t.code} - ${t.name}`, pick: () => pickTeam(t), list: picked.teams, key: t.code }))
    .filter((h) => ws.every((w) => h.label.toLowerCase().includes(w)))
    .slice(0, 30);
}
// Teams first (there are only a few dozen), then players; Enter picks the first hit.
const searchHits = (q) => [...searchTeams(q), ...searchPlayers(q)];
function renderSearch() {
  const q = $("search").value, teams = searchTeams(q), players = searchPlayers(q), ul = $("search-results");
  const item = (h) => {
    const add = addButton(h.list, h.key, h.label);
    add.onclick = null;
    add.onmousedown = (e) => { e.preventDefault(); toggle(h.list, h.key); pickSearch(); render(); };   // before the input's blur
    const b = el("button", { type: "button" }, h.label);
    b.onmousedown = (e) => { e.preventDefault(); h.pick(); };
    const li = el("li", { className: "hit" });
    li.append(add, b);
    return li;
  };
  ul.replaceChildren();
  for (const [title, hits] of [["Teams", teams], ["Players", players]])
    if (hits.length) ul.append(el("li", { className: "group" }, title), ...hits.map(item));
  if (!ul.children.length && q.trim()) ul.append(el("li", { className: "none" }, "No players or teams found"));
  ul.hidden = !ul.children.length;
}
function closeSearch() {
  $("search").value = "";
  $("search-results").hidden = true;
}
function pickSearch() {   // empty the box and drop focus, so a phone's keyboard closes
  closeSearch();
  $("search").blur();
}
function pickPlayer(t, p) {
  pickSearch();
  showPlayer(t, p);
}
function pickTeam(t) {
  collapsed.clear();
  pickSearch();
  $("division").value = t.code[0];
  resetViewSorts();
  fillTeams();
  $("team").value = t.code;
  $("player").value = "none";   // just the team, even when one of its players was showing
  fillPlayers();
}
// Back to the default view: the saved division and team, the search box empty.
function resetView() {
  collapsed.clear();
  closeSearch();
  $("division").value = homeDivision();
  resetViewSorts();
  $("team").value = "";
  fillTeams();
  $("team").value = homeTeam();
  $("player").value = "none";
  fillPlayers();
}
function showPlayer(t, p) {
  collapsed.clear();
  $("division").value = t.code[0];
  fillTeams();
  $("team").value = t.code;
  fillPlayers();
  $("player").value = playerKey(t, p);
  render();
}

// ---- wiring --------------------------------------------------------------
// Page (next to Week): Standings is the stats tables; the others are newsletter pages.
// A control shows only on the pages in its data-pages.
const PAGES = { standings: () => renderStandings(), predictions: () => show(predictionsView()),
  trophy: () => show(trophyPage()), leaders: () => show(leadersView()), hot: () => show(hotView()),
  schedule: async () => { const parts = await scheduleView(); if ($("page").value === "schedule") show(parts); } };
const show = (parts) => out.replaceChildren(...parts);
// On a phone a long team or player name wraps: its first line stays on the left and every
// line after it goes on the right, and the name's box is as wide as its widest line, so the
// lines line up with each other (not with the cell's edge). CSS can't do either (it only
// moves the last line, and a wrapped box fills its cell), so this finds where each line
// breaks (each word's top), measures the lines and splits the name into them: .first and
// .rest (style.css). In three passes (write, read, write) so the page is laid out once, not
// once per name.
const PHONE = matchMedia("(max-width: 640px)");
function alignNames() {
  const spans = [...$("out").querySelectorAll(".namebox > span")];
  for (const s of spans) {
    const text = s.dataset.name ?? (s.dataset.name = s.textContent);
    const words = text.split(" ");
    s.style.width = "";
    if (PHONE.matches && words.length > 1)   // one span per word, the spaces between them
      s.replaceChildren(...words.flatMap((w, i) => (i ? [" ", el("span", {}, w)] : [el("span", {}, w)])));
    else s.textContent = text;
  }
  const layouts = spans.map((s) => {   // [{words, width}, ...] per line
    const lines = [];
    for (const w of s.children) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(w.offsetTop - line.top) <= 2) {
        line.words.push(w.textContent);
        line.width = w.offsetLeft + w.offsetWidth - line.left;
      } else lines.push({ top: w.offsetTop, left: w.offsetLeft, width: w.offsetWidth, words: [w.textContent] });
    }
    return lines;
  });
  spans.forEach((s, i) => {
    const lines = layouts[i];
    if (lines.length < 2) { s.textContent = s.dataset.name; return; }
    s.replaceChildren(...lines.map((l, j) => el("span", { className: j ? "rest" : "first" }, l.words.join(" "))));
    s.style.width = `${Math.ceil(Math.max(...lines.map((l) => l.width)))}px`;
  });
}
// The title row and controls box stop at 860px (style.css), but on Stats, when the Show boxes
// make the tables wider than that, they widen to the widest table so the box's border (and the ?)
// line up with them.
function fitControls() {
  const widest = $("page").value === "standings"
    ? Math.max(0, ...[...$("out").querySelectorAll("table.stats")].map((t) => t.offsetWidth)) : 0;
  for (const e of [document.querySelector("header"), $("rdl-controls")])
    e.style.maxWidth = widest > 860 ? `${widest}px` : "";
}
// Again whenever the tables change (any view, sort, collapse) or the phone turns.
let aligning = 0;
const alignSoon = () => { cancelAnimationFrame(aligning); aligning = requestAnimationFrame(() => {
  namesSeen.disconnect(); alignNames(); fitControls(); namesSeen.observe($("out"), { childList: true, subtree: true }); }); };
const namesSeen = new MutationObserver(alignSoon);
namesSeen.observe($("out"), { childList: true, subtree: true });
PHONE.addEventListener("change", alignSoon);
addEventListener("resize", alignSoon);

function render() {
  const page = $("page").value;
  document.querySelectorAll("[data-pages]").forEach((e) => (e.hidden = !e.dataset.pages.split(" ").includes(page)));
  if (news) PAGES[page]();
}

$("newsletter").onchange = () => { saveView(); loadNewsletter(); };
$("season").onchange = () => { fillWeeks(); saveView(); loadNewsletter(); };
// Picking from the dropdowns replaces a searched-for player, so the box empties.
$("division").onchange = () => { collapsed.clear(); closeSearch(); resetViewSorts(); fillTeams(); saveView(); };
$("team").onchange = () => { collapsed.clear(); saveView(); closeSearch(); fillPlayers(); };
$("player").onchange = () => { collapsed.clear(); closeSearch(); render(); };
$("trophy").onchange = $("board").onchange = $("schedweek").onchange = render;
$("page").onchange = () => { closeSearch(); render(); };
$("view-reset").onclick = clearPicked;
// The ? (top right) opens Help as a popup.
$("cmp-help-toggle").onclick = () => $("cmp-help").showModal();
// The footer's License link (public site) opens the license in a popup, like Help, instead
// of leaving the page with no way back (LICENSE.txt is still the link for no-JS / new tab).
async function openLicense(e) {
  const a = e.target.closest('a[href="LICENSE.txt"]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const box = document.getElementById("license-text");
  if (!box.childElementCount) {
    try {
      const text = await (await fetch("LICENSE.txt")).text();
      // The file's lines are wrapped: one paragraph per blank-line-separated block.
      box.replaceChildren(...text.trim().split(/\n\s*\n/).map((para) =>
        Object.assign(document.createElement("p"), { textContent: para.replace(/\n/g, " ") })));
    } catch { location.href = a.href; return; }
  }
  document.getElementById("license").showModal();
}
document.addEventListener("click", openLicense);
// Every popup (Help, License): ×, Esc or a tap outside it closes it.
document.querySelectorAll("dialog.popup").forEach((d) => {
  d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
});
$("search").oninput = $("search").onfocus = renderSearch;
$("search").onkeydown = (e) => {
  if (e.key === "Escape") closeSearch();
  if (e.key === "Enter") searchHits(e.target.value)[0]?.pick();
};
$("search").onblur = () => { $("search-results").hidden = true; };
// The Show checkboxes are remembered in this browser, so the next visit opens with the same columns.
const groupBoxes = document.querySelectorAll(".groups input");
if (Array.isArray(saved.groups)) groupBoxes.forEach((c) => (c.checked = saved.groups.includes(c.value)));
groupBoxes.forEach((c) => (c.onchange = () => {
  saved.groups = [...groupBoxes].filter((b) => b.checked).map((b) => b.value);
  try { localStorage.setItem(SAVED, JSON.stringify(saved)); } catch {}
  render();
}));

(async () => {
  try { catalog = await getJSON("/api/catalog"); }
  catch (e) { return message(e.message, "error"); }
  const seasons = [...new Set(catalog.rdl.map(seasonOf))].reverse();   // newest season on top
  fill($("season"), seasons.map((x) => [x, x]));
  // Start on the saved week, or the latest when there's a newer one (or nothing saved).
  const latest = catalog.rdl[catalog.rdl.length - 1];
  const start = (saved.latest === latest?.file && catalog.rdl.find((n) => n.file === saved.week)) || latest;
  $("season").value = start ? seasonOf(start) : "";
  fillWeeks();
  if (start) $("newsletter").value = start.file;
  loadNewsletter();
})();

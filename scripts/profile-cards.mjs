/**
 * Renders the profile's live cards from GitHub data, in the portfolio palette:
 *   activity-{es,en}[-dark].svg       yearly totals, streaks and a weekday chart
 *   collaborators-{es,en}[-dark].svg  people I share public repositories with
 *
 * Usage: GITHUB_TOKEN=... node scripts/profile-cards.mjs <user> <out-dir>
 *
 * Runs in the snake workflow with the default GITHUB_TOKEN: no third-party
 * card service (the public ones are rate-limited and go blank), no extra
 * secret. Only public repositories are read, so nothing private is named.
 * Avatars are embedded as data URIs because GitHub's image proxy blocks
 * external images inside an SVG.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user = "DaGeus15", out = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const headers = { Authorization: `Bearer ${token}`, "User-Agent": "profile-cards" };
const gql = async (query, variables = {}) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};
const rest = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

/* ---------- Data ---------- */

const data = await gql(
  `query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date weekday contributionCount } }
        }
      }
      repositoriesContributedTo(first: 100, includeUserRepositories: true, privacy: PUBLIC,
        contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) {
        nodes { nameWithOwner name isFork isPrivate }
      }
      repositories(first: 100, privacy: PUBLIC, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
        nodes { nameWithOwner name isFork isPrivate }
      }
    }
  }`,
  { login: user },
);

const calendar = data.user.contributionsCollection.contributionCalendar;
const days = calendar.weeks.flatMap((w) => w.contributionDays);

const streaks = (() => {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // The current streak survives a quiet today: count back from yesterday.
  let current = 0;
  const back = [...days].reverse();
  const start = back[0]?.contributionCount > 0 ? 0 : 1;
  for (const d of back.slice(start)) {
    if (d.contributionCount === 0) break;
    current += 1;
  }
  return { longest, current };
})();

// GitHub's weekday is 0 = Sunday; the chart starts on Monday.
const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((wd) =>
  days.filter((d) => d.weekday === wd).reduce((sum, d) => sum + d.contributionCount, 0),
);
const activeDays = days.filter((d) => d.contributionCount > 0).length;

const repos = new Map();
for (const r of [...data.user.repositoriesContributedTo.nodes, ...data.user.repositories.nodes]) {
  if (!r.isFork && !r.isPrivate) repos.set(r.nameWithOwner, r);
}

// Accounts that are not people I worked with: the client's shared account.
const EXCLUDE = new Set(["junta-agua-uta", "kiramman-mp3"]);

const people = new Map();
for (const repo of repos.values()) {
  let contributors = [];
  try {
    contributors = await rest(`/repos/${repo.nameWithOwner}/contributors?per_page=100`);
  } catch {
    continue; // empty or unavailable repository
  }
  if (!contributors.some((c) => c.login?.toLowerCase() === user.toLowerCase())) continue;
  for (const c of contributors) {
    if (!c.login || c.type !== "User" || c.login.toLowerCase() === user.toLowerCase()) continue;
    if (EXCLUDE.has(c.login.toLowerCase())) continue;
    const p = people.get(c.login) ?? { login: c.login, avatar: c.avatar_url, repos: [], commits: 0 };
    p.repos.push(repo.name);
    p.commits += c.contributions;
    people.set(c.login, p);
  }
}
const collaborators = [...people.values()]
  .sort((a, b) => b.repos.length - a.repos.length || b.commits - a.commits)
  .slice(0, 4); // the four I have worked with the most

for (const p of collaborators) {
  const res = await fetch(`${p.avatar}${p.avatar.includes("?") ? "&" : "?"}s=96`);
  const type = res.headers.get("content-type") ?? "image/png";
  p.image = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/* ---------- Rendering ---------- */

// Same families as the snake and the portfolio: ink, muted, brass, track.
const THEMES = {
  light: { ink: "#1f2a44", muted: "#6b6458", brass: "#805125", bar: "#bd9870", track: "#e9e5dd", line: "#e2dccf" },
  dark: { ink: "#e6e1d8", muted: "#9ea6ae", brass: "#f0ce93", bar: "#b59060", track: "#1c2734", line: "#2a3442" },
};
const TEXT = {
  es: {
    total: "contribuciones en el último año",
    active: "días con actividad",
    longest: "días de racha más larga",
    current: "días de racha actual",
    weekdays: ["L", "M", "X", "J", "V", "S", "D"],
    byDay: "Por día de la semana",
    activityTitle: "Actividad en GitHub en el último año",
    collabTitle: "Personas con las que comparto repositorios públicos",
    shared: (n) => (n === 1 ? "1 repositorio" : `${n} repositorios`),
  },
  en: {
    total: "contributions in the last year",
    active: "active days",
    longest: "day longest streak",
    current: "day current streak",
    weekdays: ["M", "T", "W", "T", "F", "S", "S"],
    byDay: "By day of the week",
    activityTitle: "GitHub activity in the last year",
    collabTitle: "People I share public repositories with",
    shared: (n) => (n === 1 ? "1 repository" : `${n} repositories`),
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (lang, n) => n.toLocaleString(lang === "es" ? "es-ES" : "en-US");
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

// Motion: one entrance, then still. Reduced motion shows the final frame.
const motion = `
  .in { opacity: 0; animation: in .6s cubic-bezier(.2,.7,.2,1) forwards; }
  .grow { transform-box: fill-box; transform-origin: 50% 100%; transform: scaleY(0);
          animation: grow .9s cubic-bezier(.2,.7,.2,1) forwards; }
  @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes grow { to { transform: scaleY(1); } }
  @media (prefers-reduced-motion: reduce) {
    .in, .grow { animation: none; opacity: 1; transform: none; }
  }`;

function activityCard(lang, t) {
  const x = TEXT[lang];
  const W = 840;
  const H = 188;
  const stats = [
    [fmt(lang, calendar.totalContributions), x.total],
    [fmt(lang, activeDays), x.active],
    [fmt(lang, streaks.longest), x.longest],
    [fmt(lang, streaks.current), x.current],
  ];
  const statsSvg = stats
    .map(([n, label], i) => {
      const cx = 24 + (i % 2) * 196;
      const cy = 64 + Math.floor(i / 2) * 70;
      return `<g class="in" style="animation-delay:${i * 90}ms">
        <text x="${cx}" y="${cy}" font-family="${MONO}" font-size="30" font-weight="600" fill="${i === 0 ? t.brass : t.ink}">${esc(n)}</text>
        <text x="${cx}" y="${cy + 22}" font-family="${SANS}" font-size="13" fill="${t.muted}">${esc(label)}</text>
      </g>`;
    })
    .join("");

  const max = Math.max(1, ...byWeekday);
  const chartX = 470;
  const barW = 30;
  const gap = 16;
  const top = 42;
  const base = 146;
  const bars = byWeekday
    .map((v, i) => {
      const h = Math.max(3, Math.round(((base - top) * v) / max));
      const bx = chartX + i * (barW + gap);
      return `<rect x="${bx}" y="${top}" width="${barW}" height="${base - top}" rx="6" fill="${t.track}"/>
        <rect class="grow" style="animation-delay:${200 + i * 70}ms" x="${bx}" y="${base - h}" width="${barW}" height="${h}" rx="6" fill="${v === max ? t.brass : t.bar}"/>
        <text x="${bx + barW / 2}" y="${base + 20}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${t.muted}">${x.weekdays[i]}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(x.activityTitle)}: ${esc(stats.map((s) => s.join(" ")).join(", "))}">
  <title>${esc(x.activityTitle)}</title>
  <style>${motion}</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${t.line}"/>
  ${statsSvg}
  <line x1="438" y1="28" x2="438" y2="${H - 28}" stroke="${t.line}"/>
  <text x="${chartX}" y="28" font-family="${SANS}" font-size="12" fill="${t.muted}">${esc(x.byDay)}</text>
  ${bars}
</svg>`;
}

function collaboratorsCard(lang, t) {
  const x = TEXT[lang];
  const W = 840;
  const cols = 4;
  const cellW = (W - 32) / cols;
  const rowH = 78;
  const rows = Math.max(1, Math.ceil(collaborators.length / cols));
  const H = 24 + rows * rowH;
  const cells = collaborators
    .map((p, i) => {
      const cx = 16 + (i % cols) * cellW;
      const cy = 18 + Math.floor(i / cols) * rowH;
      const id = `a${i}`;
      return `<g class="in" style="animation-delay:${i * 80}ms">
        <clipPath id="${id}"><circle cx="${cx + 28}" cy="${cy + 28}" r="24"/></clipPath>
        <circle cx="${cx + 28}" cy="${cy + 28}" r="25.5" fill="none" stroke="${t.line}"/>
        <image href="${p.image}" x="${cx + 4}" y="${cy + 4}" width="48" height="48" clip-path="url(#${id})"/>
        <text x="${cx + 64}" y="${cy + 24}" font-family="${SANS}" font-size="14" font-weight="600" fill="${t.ink}">@${esc(p.login)}</text>
        <text x="${cx + 64}" y="${cy + 43}" font-family="${SANS}" font-size="12" fill="${t.muted}">${esc(x.shared(p.repos.length))}</text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(x.collabTitle)}: ${esc(collaborators.map((p) => "@" + p.login).join(", "))}">
  <title>${esc(x.collabTitle)}</title>
  <style>${motion}</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${t.line}"/>
  ${cells}
</svg>`;
}

mkdirSync(out, { recursive: true });
for (const lang of ["es", "en"]) {
  for (const [theme, t] of Object.entries(THEMES)) {
    const suffix = theme === "dark" ? "-dark" : "";
    writeFileSync(join(out, `activity-${lang}${suffix}.svg`), activityCard(lang, t));
    if (collaborators.length) writeFileSync(join(out, `collaborators-${lang}${suffix}.svg`), collaboratorsCard(lang, t));
  }
}
console.log(
  `${calendar.totalContributions} contributions, streaks ${streaks.longest}/${streaks.current}, ` +
    `${repos.size} public repos, collaborators: ${collaborators.map((p) => `${p.login}(${p.repos.join("+")})`).join(", ")}`,
);

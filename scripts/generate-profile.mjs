#!/usr/bin/env node

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const config = {
  username: process.env.PROFILE_USERNAME || "jomeswang",
  displayName: "jomeswang",
  timezone: "Asia/Shanghai",
  days: 30,
  scopeLabel: "repositories visible to the token",
  intro: [
    "I build web apps, automation workflows, and AI-driven product experiments.",
    "Lately I have been focused on dashboards, developer tooling, and practical full-stack products."
  ],
  focus: [
    "Next.js, React 19, and modern TypeScript stacks",
    "Agent dashboards, internal tools, and workflow automation",
    "Small products that turn ideas into something people can actually use"
  ],
  featuredProjects: [
    {
      name: "openclaw-TenacitOS",
      url: "https://github.com/jomeswang/openclaw-TenacitOS",
      summary: "A real-time dashboard and control center for OpenClaw AI agent instances."
    },
    {
      name: "iodraw-files",
      url: "https://github.com/jomeswang/iodraw-files",
      summary: "Diagram, whiteboard, and code-drawing assets for visualization workflows."
    },
    {
      name: "pick-packet-dapp",
      url: "https://github.com/jomeswang/pick-packet-dapp",
      summary: "A TypeScript DApp experiment focused on interactive blockchain product ideas."
    },
    {
      name: "pythonWebCrawler",
      url: "https://github.com/jomeswang/pythonWebCrawler",
      summary: "Python crawler examples and notes aimed at practical learning and experimentation."
    }
  ]
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const readmePath = path.join(repoRoot, "README.md");
const cardPath = path.join(repoRoot, "assets", "activity-card.svg");

function getToken() {
  const candidates = ["PROFILE_STATS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];

  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("Missing GitHub token. Set PROFILE_STATS_TOKEN, GITHUB_TOKEN, or log in with gh auth login.");
  }
}

function getWindow(days) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateOnly(value, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: config.timezone,
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(value);
}

function formatDateTime(value, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: config.timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function toSearchDate(value) {
  return value.toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isWithinWindow(value, start, end) {
  return value >= start && value <= end;
}

function uniqueBy(values, getKey) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = getKey(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(String(url), {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${getToken()}`,
      "Accept": options.accept ?? "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "jomeswang-profile-generator",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed with ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function searchAll(kind, options) {
  const items = [];
  const perPage = 100;
  const hardLimit = 1000;

  for (let page = 1; page <= hardLimit / perPage; page += 1) {
    const url = new URL(`https://api.github.com/search/${kind}`);
    url.searchParams.set("q", options.query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    if (options.sort) {
      url.searchParams.set("sort", options.sort);
    }

    if (options.order) {
      url.searchParams.set("order", options.order);
    }

    const payload = await githubRequest(url, { accept: options.accept });
    items.push(...(payload.items ?? []));

    const totalCount = Math.min(payload.total_count ?? 0, hardLimit);
    if (!payload.items?.length || payload.items.length < perPage || items.length >= totalCount) {
      break;
    }
  }

  return items;
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < values.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, values.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function getMergedPullRequests(username, start, end) {
  const query = `author:${username} is:pr is:merged archived:false merged:${toSearchDate(start)}..${toSearchDate(end)}`;
  const results = await searchAll("issues", {
    query,
    sort: "updated",
    order: "desc"
  });

  const detailUrls = uniqueBy(
    results
      .map((item) => item.pull_request?.url)
      .filter(Boolean),
    (url) => url
  );

  const pullRequests = await mapWithConcurrency(detailUrls, 8, async (url) => githubRequest(url));
  const mergedPullRequests = pullRequests.filter((pullRequest) => {
    const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
    return mergedAt && isWithinWindow(mergedAt, start, end);
  });

  return {
    count: mergedPullRequests.length,
    additions: mergedPullRequests.reduce((sum, pullRequest) => sum + (pullRequest.additions ?? 0), 0),
    deletions: mergedPullRequests.reduce((sum, pullRequest) => sum + (pullRequest.deletions ?? 0), 0)
  };
}

async function getAuthoredCommitCount(username, start, end) {
  const query = `author:${username} author-date:${toSearchDate(start)}..${toSearchDate(end)}`;
  const results = await searchAll("commits", {
    query,
    sort: "author-date",
    order: "desc",
    accept: "application/vnd.github.cloak-preview+json"
  });

  const uniqueCommits = new Set();

  for (const result of results) {
    const authoredAt = result.commit?.author?.date ? new Date(result.commit.author.date) : null;
    if (!authoredAt || !isWithinWindow(authoredAt, start, end)) {
      continue;
    }

    uniqueCommits.add(`${result.repository.full_name}:${result.sha}`);
  }

  return uniqueCommits.size;
}

function buildSvgCard(stats) {
  const mergedPrs = formatNumber(stats.mergedPrs);
  const additions = formatNumber(stats.additions);
  const deletions = formatNumber(stats.deletions);
  const commits = formatNumber(stats.commits);
  const windowLabel = `${formatDateOnly(stats.windowStart)} - ${formatDateOnly(stats.windowEnd)}`;
  const updatedLabel = `${formatDateTime(stats.generatedAt)} ${config.timezone}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="860" height="320" viewBox="0 0 860 320" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">GitHub 30-day activity summary</title>
  <desc id="desc">Merged pull requests, additions and deletions, and authored commits for the last 30 days.</desc>
  <style>
    .canvas { fill: #F6F8FA; }
    .panel { fill: #FFFFFF; stroke: #D0D7DE; }
    .accent { fill: url(#accentGradient); }
    .title { fill: #1F2328; font: 700 26px 'Segoe UI', Ubuntu, Sans-Serif; }
    .subtitle { fill: #59636E; font: 500 13px 'Segoe UI', Ubuntu, Sans-Serif; }
    .stat-label { fill: #59636E; font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; letter-spacing: 0.08em; text-transform: uppercase; }
    .stat-value { fill: #1F2328; font: 700 30px 'Segoe UI', Ubuntu, Sans-Serif; }
    .stat-detail { fill: #59636E; font: 500 13px 'Segoe UI', Ubuntu, Sans-Serif; }
    .footer { fill: #59636E; font: 500 12px 'Segoe UI', Ubuntu, Sans-Serif; }
    @media (prefers-color-scheme: dark) {
      .canvas { fill: #0D1117; }
      .panel { fill: #161B22; stroke: #30363D; }
      .title { fill: #F0F6FC; }
      .subtitle { fill: #8B949E; }
      .stat-label { fill: #8B949E; }
      .stat-value { fill: #F0F6FC; }
      .stat-detail { fill: #8B949E; }
      .footer { fill: #8B949E; }
    }
  </style>
  <defs>
    <linearGradient id="accentGradient" x1="0" y1="0" x2="860" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2F81F7" />
      <stop offset="100%" stop-color="#0EA5A3" />
    </linearGradient>
  </defs>
  <rect class="canvas" x="0" y="0" width="860" height="320" rx="28" />
  <rect class="accent" x="24" y="24" width="812" height="92" rx="24" opacity="0.16" />
  <text class="title" x="44" y="68">Last 30 Days on GitHub</text>
  <text class="subtitle" x="44" y="93">A rolling snapshot across ${escapeXml(config.scopeLabel)}.</text>
  <text class="subtitle" x="640" y="68">Window</text>
  <text class="title" x="640" y="96" text-anchor="start" style="font-size:18px;">${escapeXml(windowLabel)}</text>

  <rect class="panel" x="24" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="44" y="168">Merged PRs</text>
  <text class="stat-value" x="44" y="214">${escapeXml(mergedPrs)}</text>
  <text class="stat-detail" x="44" y="242">Merged pull requests across accessible repos</text>

  <rect class="panel" x="306" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="326" y="168">Additions / Deletions</text>
  <text class="stat-value" x="326" y="214">+${escapeXml(additions)}</text>
  <text class="stat-detail" x="326" y="242">-${escapeXml(deletions)} lines from merged pull requests</text>

  <rect class="panel" x="588" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="608" y="168">Authored Commits</text>
  <text class="stat-value" x="608" y="214">${escapeXml(commits)}</text>
  <text class="stat-detail" x="608" y="242">Commits authored across accessible repositories</text>

  <text class="footer" x="44" y="290">Updated: ${escapeXml(updatedLabel)}</text>
  <text class="footer" x="816" y="290" text-anchor="end">Source: GitHub Search API</text>
</svg>
`;
}

function buildReadme(stats) {
  const mergedPrs = formatNumber(stats.mergedPrs);
  const additions = formatNumber(stats.additions);
  const deletions = formatNumber(stats.deletions);
  const commits = formatNumber(stats.commits);
  const windowLabel = `${formatDateOnly(stats.windowStart)} - ${formatDateOnly(stats.windowEnd)}`;
  const updatedLabel = `${formatDateTime(stats.generatedAt)} ${config.timezone}`;
  const focusLines = config.focus.map((entry) => `- ${entry}`).join("\n");
  const projectRows = config.featuredProjects
    .map((project) => `| [${project.name}](${project.url}) | ${project.summary} |`)
    .join("\n");

  return `# Hi, I'm ${config.displayName}

${config.intro.join(" ")}

${focusLines}

## 30-Day GitHub Snapshot

![30-day GitHub activity card](./assets/activity-card.svg)

| Metric | Value |
| --- | --- |
| Merged PRs | **${mergedPrs}** |
| Additions / Deletions | **+${additions} / -${deletions}** |
| Authored commits | **${commits}** |
| Window | **${windowLabel}** |
| Last updated | **${updatedLabel}** |

These stats cover **${config.scopeLabel}**. When the PROFILE_STATS_TOKEN secret is configured in this repo, that includes private and organization repositories the token can read.

## Featured Projects

| Project | Summary |
| --- | --- |
${projectRows}

## How This README Works

- [scripts/generate-profile.mjs](./scripts/generate-profile.mjs) pulls PR and commit data from the GitHub Search API.
- [assets/activity-card.svg](./assets/activity-card.svg) is regenerated together with this README so the card always stays in sync.
- [.github/workflows/update-profile.yml](./.github/workflows/update-profile.yml) refreshes the snapshot every day and on manual runs.
- GitHub's contribution graph can still look larger because it also includes issues, reviews, and restricted private contributions.
`;
}

async function main() {
  const { start, end } = getWindow(config.days);
  const [commits, pullRequests] = await Promise.all([
    getAuthoredCommitCount(config.username, start, end),
    getMergedPullRequests(config.username, start, end)
  ]);

  const stats = {
    mergedPrs: pullRequests.count,
    additions: pullRequests.additions,
    deletions: pullRequests.deletions,
    commits,
    windowStart: start,
    windowEnd: end,
    generatedAt: new Date()
  };

  await fs.writeFile(cardPath, buildSvgCard(stats), "utf8");
  await fs.writeFile(readmePath, buildReadme(stats), "utf8");

  console.log(`Generated README and card for ${config.username}`);
  console.log(`Merged PRs: ${stats.mergedPrs}`);
  console.log(`Additions / Deletions: +${stats.additions} / -${stats.deletions}`);
  console.log(`Authored commits: ${stats.commits}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

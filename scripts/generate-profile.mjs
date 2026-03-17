#!/usr/bin/env node

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const config = {
  username: process.env.PROFILE_USERNAME || "jomeswang",
  displayName: "jomeswang",
  role: "Web apps, automation, and AI tooling",
  timezone: "Asia/Shanghai",
  days: 30,
  publicOnly: true,
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
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN.trim();
  }

  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN.trim();
  }

  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (error) {
    throw new Error("Missing GITHUB_TOKEN. Set GITHUB_TOKEN or log in with gh auth login.");
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

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function githubGraphQL(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      "User-Agent": "jomeswang-profile-generator"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message).join("; "));
  }

  return payload.data;
}

async function getCommitContributions(username, start, end) {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
        }
      }
    }
  `;

  const data = await githubGraphQL(query, {
    login: username,
    from: start.toISOString(),
    to: end.toISOString()
  });

  return data.user?.contributionsCollection?.totalCommitContributions ?? 0;
}

async function getMergedPullRequests(username, start, end) {
  const query = `
    query($searchQuery: String!, $cursor: String) {
      search(type: ISSUE, query: $searchQuery, first: 100, after: $cursor) {
        nodes {
          ... on PullRequest {
            mergedAt
            additions
            deletions
            repository {
              isPrivate
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const fromDate = start.toISOString().slice(0, 10);
  const toDate = end.toISOString().slice(0, 10);
  const searchQuery = `author:${username} is:pr is:merged merged:${fromDate}..${toDate} sort:updated-desc`;

  let cursor = null;
  const pullRequests = [];

  do {
    const data = await githubGraphQL(query, { searchQuery, cursor });
    const search = data.search;

    for (const node of search.nodes ?? []) {
      if (!node) {
        continue;
      }

      if (config.publicOnly && node.repository?.isPrivate) {
        continue;
      }

      const mergedAt = node.mergedAt ? new Date(node.mergedAt) : null;
      if (!mergedAt) {
        continue;
      }

      if (mergedAt < start || mergedAt > end) {
        continue;
      }

      pullRequests.push(node);
    }

    cursor = search.pageInfo?.hasNextPage ? search.pageInfo.endCursor : null;
  } while (cursor);

  const additions = pullRequests.reduce((sum, pr) => sum + (pr.additions ?? 0), 0);
  const deletions = pullRequests.reduce((sum, pr) => sum + (pr.deletions ?? 0), 0);

  return {
    count: pullRequests.length,
    additions,
    deletions
  };
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
  <desc id="desc">Merged pull requests, additions and deletions, and commit contributions for the last 30 days.</desc>
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
  <text class="subtitle" x="44" y="93">A rolling public-activity snapshot generated automatically.</text>
  <text class="subtitle" x="640" y="68">Window</text>
  <text class="title" x="640" y="96" text-anchor="start" style="font-size:18px;">${escapeXml(windowLabel)}</text>

  <rect class="panel" x="24" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="44" y="168">Merged PRs</text>
  <text class="stat-value" x="44" y="214">${escapeXml(mergedPrs)}</text>
  <text class="stat-detail" x="44" y="242">Merged pull requests in public repositories</text>

  <rect class="panel" x="306" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="326" y="168">Additions / Deletions</text>
  <text class="stat-value" x="326" y="214">+${escapeXml(additions)}</text>
  <text class="stat-detail" x="326" y="242">-${escapeXml(deletions)} lines merged in public pull requests</text>

  <rect class="panel" x="588" y="136" width="248" height="128" rx="22" />
  <text class="stat-label" x="608" y="168">Commit Contributions</text>
  <text class="stat-value" x="608" y="214">${escapeXml(commits)}</text>
  <text class="stat-detail" x="608" y="242">Commits counted by GitHub contributions</text>

  <text class="footer" x="44" y="290">Updated: ${escapeXml(updatedLabel)}</text>
  <text class="footer" x="816" y="290" text-anchor="end">Source: GitHub GraphQL API</text>
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
| Commit contributions | **${commits}** |
| Window | **${windowLabel}** |
| Last updated | **${updatedLabel}** |

## Featured Projects

| Project | Summary |
| --- | --- |
${projectRows}

## How This README Works

- [scripts/generate-profile.mjs](./scripts/generate-profile.mjs) pulls the latest activity data from the GitHub GraphQL API.
- [assets/activity-card.svg](./assets/activity-card.svg) is regenerated together with this README so the card always stays in sync.
- [.github/workflows/update-profile.yml](./.github/workflows/update-profile.yml) refreshes the snapshot every day and on manual runs.
- The current stats are based on public activity only.
`;
}

async function main() {
  const { start, end } = getWindow(config.days);
  const [commits, pullRequests] = await Promise.all([
    getCommitContributions(config.username, start, end),
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
  console.log(`Commit contributions: ${stats.commits}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

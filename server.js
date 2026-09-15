```javascript
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("."));

const FACEIT_API = "https://open.faceit.com/data/v4";

const NICKNAME = "wisde";
const GAME = "cs2";

const ELO_FILE = path.join(__dirname, "elo-history.json");

// ============================================================
// CACHE
// ============================================================

let playerCache = null;
let playerCacheTime = 0;

let statsCache = null;
let statsCacheTime = 0;

const PLAYER_CACHE_TIME = 5 * 60 * 1000;
const STATS_CACHE_TIME = 60 * 1000;


// ============================================================
// EMPTY ELO HISTORY
// ============================================================

function emptyEloHistory() {
  return {
    days: {},
    months: {},
    matches: {}
  };
}


// ============================================================
// LOAD ELO HISTORY
// ============================================================

function loadEloHistory() {
  try {
    if (!fs.existsSync(ELO_FILE)) {
      return emptyEloHistory();
    }

    const raw = fs.readFileSync(ELO_FILE, "utf8");

    if (!raw.trim()) {
      return emptyEloHistory();
    }

    const data = JSON.parse(raw);

    if (!data || typeof data !== "object") {
      return emptyEloHistory();
    }

    if (!data.days || typeof data.days !== "object") {
      data.days = {};
    }

    if (!data.months || typeof data.months !== "object") {
      data.months = {};
    }

    if (!data.matches || typeof data.matches !== "object") {
      data.matches = {};
    }

    return data;

  } catch (error) {
    console.error("Erro ao ler elo-history.json:", error);
    return emptyEloHistory();
  }
}


// ============================================================
// SAVE ELO HISTORY
// ============================================================

function saveEloHistory(history) {
  try {
    fs.writeFileSync(
      ELO_FILE,
      JSON.stringify(history, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error(
      "Erro ao guardar elo-history.json:",
      error
    );
  }
}


// ============================================================
// PORTUGAL DATE
// ============================================================

function getPortugalDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day)
  };
}


function getPortugalDateString(date = new Date()) {
  const d = getPortugalDateParts(date);

  return (
    `${d.year}-` +
    `${String(d.month).padStart(2, "0")}-` +
    `${String(d.day).padStart(2, "0")}`
  );
}


function getPortugalMonthString(date = new Date()) {
  const d = getPortugalDateParts(date);

  return (
    `${d.year}-` +
    `${String(d.month).padStart(2, "0")}`
  );
}


// ============================================================
// FACEIT API
// ============================================================

async function faceitFetch(url, label) {
  const apiKey = process.env.FACEIT_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FACEIT_API_KEY não configurada no Render."
    );
  }

  console.log(`FACEIT → ${label}`);

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });

  } catch (error) {
    console.error(
      `FACEIT NETWORK ERROR → ${label}`
    );

    console.error(error);

    throw new Error(
      `Erro de ligação à FACEIT em ${label}: ${error.message}`
    );
  }

  const text = await response.text();

  if (!response.ok) {
    console.error(
      `FACEIT ERROR → ${label} → HTTP ${response.status}`
    );

    console.error(text);

    if (response.status === 401) {
      throw new Error(
        `FACEIT respondeu 401 em ${label}. Verifica a FACEIT_API_KEY no Render.`
      );
    }

    if (response.status === 429) {
      throw new Error(
        `FACEIT respondeu 429 (Too Many Requests) em ${label}.`
      );
    }

    throw new Error(
      `FACEIT respondeu HTTP ${response.status} em ${label}.`
    );
  }

  try {
    return JSON.parse(text);

  } catch (error) {
    console.error(
      `Resposta inválida da FACEIT → ${label}`
    );

    console.error(text);

    throw new Error(
      `Resposta inválida da FACEIT em ${label}.`
    );
  }
}


// ============================================================
// PLAYER
// ============================================================

async function getPlayer() {
  const now = Date.now();

  if (
    playerCache &&
    now - playerCacheTime < PLAYER_CACHE_TIME
  ) {
    return playerCache;
  }

  const url =
    `${FACEIT_API}/players?nickname=` +
    encodeURIComponent(NICKNAME);

  const player = await faceitFetch(
    url,
    "GET /players"
  );

  if (!player || !player.player_id) {
    throw new Error(
      `Jogador "${NICKNAME}" não encontrado na FACEIT.`
    );
  }

  playerCache = player;
  playerCacheTime = now;

  return player;
}


// ============================================================
// PLAYER HISTORY
// ============================================================

async function getPlayerHistory(playerId, from, to) {
  const allMatches = [];

  let offset = 0;
  const limit = 100;

  while (offset <= 1000) {

    const url =
      `${FACEIT_API}/players/${playerId}/history` +
      `?game=${GAME}` +
      `&from=${from}` +
      `&to=${to}` +
      `&offset=${offset}` +
      `&limit=${limit}`;

    const data = await faceitFetch(
      url,
      `GET /players/${playerId}/history offset=${offset}`
    );

    const items = Array.isArray(data?.items)
      ? data.items
      : [];

    allMatches.push(...items);

    if (items.length < limit) {
      break;
    }

    offset += limit;
  }

  // Remove duplicados
  const unique = [];
  const seen = new Set();

  for (const match of allMatches) {

    const id =
      match.match_id ||
      match.id ||
      `${match.started_at}-${match.finished_at}`;

    if (!seen.has(id)) {
      seen.add(id);
      unique.push(match);
    }
  }

  return unique;
}


// ============================================================
// MATCH DETAIL
// ============================================================

async function getMatchDetails(matchId) {
  if (!matchId) {
    return null;
  }

  try {
    return await faceitFetch(
      `${FACEIT_API}/matches/${matchId}`,
      `GET /matches/${matchId}`
    );

  } catch (error) {

    console.error(
      `Não foi possível obter detalhes do match ${matchId}:`,
      error.message
    );

    return null;
  }
}


// ============================================================
// PLAYER TEAM
// ============================================================

function findPlayerTeam(match, playerId) {
  if (!match?.teams) {
    return null;
  }

  for (const [teamName, team] of Object.entries(match.teams)) {

    if (!team) {
      continue;
    }

    const players =
      team.roster ||
      team.players ||
      [];

    if (!Array.isArray(players)) {
      continue;
    }

    for (const player of players) {

      if (
        player?.player_id === playerId ||
        player?.id === playerId
      ) {
        return teamName;
      }
    }
  }

  return null;
}


// ============================================================
// WINNER
// ============================================================

function findWinner(match) {
  if (!match) {
    return null;
  }

  if (match.results?.winner) {
    return match.results.winner;
  }

  if (match.winner) {
    return match.winner;
  }

  if (
    Array.isArray(match.results) &&
    match.results.length > 0
  ) {
    return match.results[0]?.winner || null;
  }

  return null;
}


// ============================================================
// MATCH RESULT
// ============================================================

async function getMatchResult(match, playerId) {

  let playerTeam =
    findPlayerTeam(
      match,
      playerId
    );

  let winner =
    findWinner(match);

  let detail = null;

  if (
    (!playerTeam || !winner) &&
    match.match_id
  ) {

    detail =
      await getMatchDetails(
        match.match_id
      );

    if (detail) {

      if (!playerTeam) {

        playerTeam =
          findPlayerTeam(
            detail,
            playerId
          );
      }

      if (!winner) {

        winner =
          findWinner(
            detail
          );

        if (
          !winner &&
          detail.detailed_results
        ) {

          for (
            const result
            of detail.detailed_results
          ) {

            if (result?.winner) {

              winner =
                result.winner;

              break;
            }
          }
        }
      }
    }
  }

  if (!playerTeam || !winner) {
    return null;
  }

  return {
    win: winner === playerTeam,
    playerTeam,
    winner,
    detail
  };
}


// ============================================================
// WINS / LOSSES
// ============================================================

async function calculateResults(matches, playerId) {

  let wins = 0;
  let losses = 0;

  for (const match of matches) {

    if (!match) {
      continue;
    }

    const status =
      String(match.status || "").toLowerCase();

    if (
      status &&
      status !== "finished" &&
      status !== "completed"
    ) {
      continue;
    }

    const result =
      await getMatchResult(
        match,
        playerId
      );

    if (!result) {
      continue;
    }

    if (result.win) {
      wins++;
    } else {
      losses++;
    }
  }

  return {
    wins,
    losses
  };
}


// ============================================================
// PLAYER STATS
// ============================================================

async function getPlayerStats(
  playerId,
  from,
  to
) {

  const url =
    `${FACEIT_API}/players/${playerId}/games/${GAME}/stats` +
    `?from=${from}` +
    `&to=${to}` +
    `&limit=100`;

  return faceitFetch(
    url,
    `GET /players/${playerId}/games/${GAME}/stats`
  );
}


// ============================================================
// K/D
// ============================================================

function calculateKD(statsData) {

  const items =
    Array.isArray(statsData?.items)
      ? statsData.items
      : [];

  let kills = 0;
  let deaths = 0;

  for (const item of items) {

    const stats =
      item?.stats || {};

    const k =
      Number(
        stats.Kills ??
        stats.kills ??
        0
      );

    const d =
      Number(
        stats.Deaths ??
        stats.deaths ??
        0
      );

    if (Number.isFinite(k)) {
      kills += k;
    }

    if (Number.isFinite(d)) {
      deaths += d;
    }
  }

  const kd =
    deaths > 0
      ? kills / deaths
      : kills;

  return {
    kills,
    deaths,
    kd
  };
}


// ============================================================
// POSSIBLE ELO EXTRACTION
// ============================================================

function findNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function extractPossibleElo(match, playerId) {

  const candidates = [];

  function add(value, source) {

    const n = findNumber(value);

    if (
      n !== null &&
      n >= 0 &&
      n <= 5000
    ) {
      candidates.push({
        value: n,
        source
      });
    }
  }

  // Common possible locations
  add(
    match?.faceit_elo,
    "match.faceit_elo"
  );

  add(
    match?.elo,
    "match.elo"
  );

  add(
    match?.player_elo,
    "match.player_elo"
  );

  add(
    match?.players?.[playerId]?.faceit_elo,
    "match.players[player].faceit_elo"
  );

  add(
    match?.players?.[playerId]?.elo,
    "match.players[player].elo"
  );

  if (Array.isArray(match?.players)) {

    const player =
      match.players.find(
        p =>
          p?.player_id === playerId ||
          p?.id === playerId
      );

    if (player) {

      add(
        player.faceit_elo,
        "match.players[].faceit_elo"
      );

      add(
        player.elo,
        "match.players[].elo"
      );
    }
  }

  return candidates.length
    ? candidates[0]
    : null;
}


// ============================================================
// SAVE / UPDATE MATCH HISTORY
// ============================================================

function updateMatchHistory(
  matches,
  playerId,
  currentElo
) {

  const history =
    loadEloHistory();

  for (const match of matches) {

    if (!match) {
      continue;
    }

    const matchId =
      match.match_id ||
      match.id;

    if (!matchId) {
      continue;
    }

    const timestamp =
      Number(
        match.finished_at ??
        match.started_at ??
        0
      );

    if (!timestamp) {
      continue;
    }

    const date =
      new Date(
        timestamp * 1000
      );

    const dateString =
      getPortugalDateString(
        date
      );

    const monthString =
      getPortugalMonthString(
        date
      );

    const result =
      findWinner(match);

    const playerTeam =
      findPlayerTeam(
        match,
        playerId
      );

    const possibleElo =
      extractPossibleElo(
        match,
        playerId
      );

    if (!history.matches[matchId]) {

      history.matches[matchId] = {
        matchId,
        date: dateString,
        month: monthString,
        startedAt:
          match.started_at || null,
        finishedAt:
          match.finished_at || null,

        result:
          playerTeam &&
          result
            ? result === playerTeam
              ? "win"
              : "loss"
            : null,

        elo:
          possibleElo
            ? possibleElo.value
            : null,

        eloSource:
          possibleElo
            ? possibleElo.source
            : null,

        recordedAt:
          Date.now()
      };

    } else {

      const saved =
        history.matches[matchId];

      if (
        possibleElo &&
        !Number.isFinite(
          Number(saved.elo)
        )
      ) {

        saved.elo =
          possibleElo.value;

        saved.eloSource =
          possibleElo.source;
      }

      if (
        !saved.result &&
        playerTeam &&
        result
      ) {

        saved.result =
          result === playerTeam
            ? "win"
            : "loss";
      }
    }
  }

  saveEloHistory(history);

  return history;
}


// ============================================================
// DAILY / MONTHLY SNAPSHOT
// ============================================================

function updateEloSnapshot(currentElo) {

  const result = {
    eloToday: 0,
    eloMonth: 0
  };

  if (!Number.isFinite(currentElo)) {
    return result;
  }

  const history =
    loadEloHistory();

  const today =
    getPortugalDateString();

  const month =
    getPortugalMonthString();

  // --------------------------
  // DAY
  // --------------------------

  if (!history.days[today]) {

    history.days[today] = {
      startElo: currentElo,
      lastElo: currentElo,
      updatedAt: Date.now()
    };

  } else {

    const day =
      history.days[today];

    if (
      !Number.isFinite(
        Number(day.startElo)
      )
    ) {
      day.startElo =
        currentElo;
    }

    day.lastElo =
      currentElo;

    day.updatedAt =
      Date.now();
  }


  // --------------------------
  // MONTH
  // --------------------------

  if (!history.months[month]) {

    history.months[month] = {
      startElo: currentElo,
      lastElo: currentElo,
      updatedAt: Date.now()
    };

  } else {

    const monthData =
      history.months[month];

    if (
      !Number.isFinite(
        Number(monthData.startElo)
      )
    ) {
      monthData.startElo =
        currentElo;
    }

    monthData.lastElo =
      currentElo;

    monthData.updatedAt =
      Date.now();
  }


  const todayStart =
    Number(
      history.days[today].startElo
    );

  const monthStart =
    Number(
      history.months[month].startElo
    );

  result.eloToday =
    currentElo - todayStart;

  result.eloMonth =
    currentElo - monthStart;

  saveEloHistory(history);

  return result;
}


// ============================================================
// ELO HISTORY SUMMARY
// ============================================================

function getEloHistorySummary() {

  const history =
    loadEloHistory();

  const today =
    getPortugalDateString();

  const month =
    getPortugalMonthString();

  const todayData =
    history.days[today] || null;

  const monthData =
    history.months[month] || null;

  const currentElo =
    monthData
      ? Number(monthData.lastElo)
      : null;

  return {
    today,
    month,

    todayData,
    monthData,

    currentElo,

    days:
      history.days,

    months:
      history.months,

    matches:
      history.matches
  };
}


// ============================================================
// MONTH RANGE
// ============================================================

function getMonthRange() {

  const date =
    getPortugalDateParts();

  const start =
    Math.floor(
      Date.UTC(
        date.year,
        date.month - 1,
        1
      ) / 1000
    ) - 172800;

  const end =
    Math.floor(
      Date.now() / 1000
    );

  return {
    year: date.year,
    month: date.month,
    from: start,
    to: end
  };
}


// ============================================================
// API /ELO-HISTORY
// ============================================================

app.get(
  "/api/elo-history",
  (req, res) => {

    try {

      const data =
        getEloHistorySummary();

      return res.json(data);

    } catch (error) {

      console.error(
        "Erro /api/elo-history:",
        error
      );

      return res.status(500).json({
        error:
          "Não foi possível obter o histórico de ELO."
      });
    }
  }
);


// ============================================================
// API /STATS
// ============================================================

app.get(
  "/api/stats",
  async (req, res) => {

    try {

      const now =
        Date.now();

      // --------------------------------------------------------
      // CACHE
      // --------------------------------------------------------

      if (
        statsCache &&
        now - statsCacheTime <
          STATS_CACHE_TIME
      ) {

        return res.json(
          statsCache
        );
      }


      // --------------------------------------------------------
      // API KEY
      // --------------------------------------------------------

      if (
        !process.env.FACEIT_API_KEY
      ) {

        return res.status(500).json({
          error:
            "FACEIT_API_KEY não configurada."
        });
      }


      console.log(
        "======================================"
      );

      console.log(
        "A iniciar atualização FACEIT..."
      );

      console.log(
        "======================================"
      );


      // --------------------------------------------------------
      // PLAYER
      // --------------------------------------------------------

      const player =
        await getPlayer();

      const playerId =
        player.player_id;

      const nickname =
        player.nickname ||
        NICKNAME;

      const currentElo =
        Number(
          player.games?.cs2?.faceit_elo
        );


      console.log(
        `Jogador: ${nickname}`
      );

      console.log(
        `Player ID: ${playerId}`
      );

      console.log(
        `Current Elo: ${currentElo}`
      );


      // --------------------------------------------------------
      // MONTH
      // --------------------------------------------------------

      const range =
        getMonthRange();

      const monthMatches =
        await getPlayerHistory(
          playerId,
          range.from,
          range.to
        );


      console.log(
        `Matches encontrados: ${monthMatches.length}`
      );


      // --------------------------------------------------------
      // SAVE MATCH HISTORY
      // --------------------------------------------------------

      updateMatchHistory(
        monthMatches,
        playerId,
        currentElo
      );


      // --------------------------------------------------------
      // WINS / LOSSES
      // --------------------------------------------------------

      const results =
        await calculateResults(
          monthMatches,
          playerId
        );

      const wins =
        results.wins;

      const losses =
        results.losses;

      const games =
        wins + losses;


      // --------------------------------------------------------
      // K/D
      // --------------------------------------------------------

      let totalKills = 0;
      let totalDeaths = 0;
      let kd = 0;

      try {

        const statsData =
          await getPlayerStats(
            playerId,
            range.from * 1000,
            Date.now()
          );

        const kdData =
          calculateKD(
            statsData
          );

        totalKills =
          kdData.kills;

        totalDeaths =
          kdData.deaths;

        kd =
          kdData.kd;

      } catch (error) {

        console.error(
          "Erro ao obter K/D:",
          error.message
        );
      }


      // --------------------------------------------------------
      // WIN RATE
      // --------------------------------------------------------

      const winRate =
        games > 0
          ? (wins / games) * 100
          : 0;


      // --------------------------------------------------------
      // GOAL
      // --------------------------------------------------------

      const goal =
        50;

      const winsRemaining =
        Math.max(
          goal - wins,
          0
        );


      // --------------------------------------------------------
      // DAYS
      // --------------------------------------------------------

      const portugalDate =
        getPortugalDateParts();

      const currentDay =
        portugalDate.day;

      const year =
        portugalDate.year;

      const month =
        portugalDate.month;

      const lastDay =
        new Date(
          year,
          month,
          0
        ).getDate();

      const daysRemaining =
        Math.max(
          lastDay - currentDay,
          0
        );


      // --------------------------------------------------------
      // PACE
      // --------------------------------------------------------

      const daysElapsed =
        Math.max(
          currentDay,
          1
        );

      const averagePerDay =
        wins / daysElapsed;

      const requiredPerDay =
        daysRemaining > 0
          ? winsRemaining / daysRemaining
          : winsRemaining;


      // --------------------------------------------------------
      // PROGRESS
      // --------------------------------------------------------

      const progress =
        goal > 0
          ? Math.min(
              (wins / goal) * 100,
              100
            )
          : 0;


      // --------------------------------------------------------
      // ELO
      // --------------------------------------------------------

      let eloToday = 0;
      let eloMonth = 0;

      if (
        Number.isFinite(
          currentElo
        )
      ) {

        const eloData =
          updateEloSnapshot(
            currentElo
          );

        eloToday =
          eloData.eloToday;

        eloMonth =
          eloData.eloMonth;
      }


      // --------------------------------------------------------
      // ELO HISTORY
      // --------------------------------------------------------

      const eloHistory =
        getEloHistorySummary();


      // --------------------------------------------------------
      // MONTH NAME
      // --------------------------------------------------------

      const monthName =
        new Intl.DateTimeFormat(
          "pt-PT",
          {
            month: "long",
            timeZone: "Europe/Lisbon"
          }
        ).format(
          new Date()
        );


      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      const response = {

        nickname,

        month:
          monthName
            .charAt(0)
            .toUpperCase() +
          monthName.slice(1),

        year,

        goal,

        wins,

        losses,

        games,

        winRate,

        kd,

        totalKills,

        totalDeaths,

        averageRating: 0,

        ratingMatches: 0,

        averagePerDay,

        requiredPerDay,

        daysRemaining,

        winsRemaining,

        progress,

        currentElo,

        eloToday,

        eloMonth,

        // Novo
        eloHistory,

        updatedAt:
          new Date().toISOString(),

        matchesFound:
          monthMatches.length
      };


      // --------------------------------------------------------
      // CACHE
      // --------------------------------------------------------

      statsCache =
        response;

      statsCacheTime =
        Date.now();


      // --------------------------------------------------------
      // LOG
      // --------------------------------------------------------

      console.log(
        "======================================"
      );

      console.log(
        "FACEIT atualizado com sucesso"
      );

      console.log(
        `Wins: ${wins}`
      );

      console.log(
        `Losses: ${losses}`
      );

      console.log(
        `Games: ${games}`
      );

      console.log(
        `Winrate: ${winRate.toFixed(2)}%`
      );

      console.log(
        `KD: ${kd.toFixed(2)}`
      );

      console.log(
        `Elo: ${currentElo}`
      );

      console.log(
        `Elo hoje: ${
          eloToday >= 0
            ? "+"
            : ""
        }${eloToday}`
      );

      console.log(
        `Elo mês: ${
          eloMonth >= 0
            ? "+"
            : ""
        }${eloMonth}`
      );

      console.log(
        "======================================"
      );


      return res.json(
        response
      );


    } catch (error) {

      console.error(
        "======================================"
      );

      console.error(
        "ERRO /api/stats:"
      );

      console.error(
        error
      );

      console.error(
        "======================================"
      );

      return res.status(500).json({

        error:
          "Não foi possível obter os dados da FACEIT.",

        details:
          error.message
      });
    }
  }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      status:
        "ok",

      faceitApiKey:
        Boolean(
          process.env.FACEIT_API_KEY
        ),

      time:
        new Date().toISOString()
    });
  }
);


// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Servidor iniciado na porta ${PORT}`
    );

    console.log(
      `FACEIT nickname: ${NICKNAME}`
    );

    console.log(
      `FACEIT API key configurada: ${
        Boolean(
          process.env.FACEIT_API_KEY
        )
      }`
    );
  }
);
```

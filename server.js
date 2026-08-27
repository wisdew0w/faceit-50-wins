const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("."));

const ELO_FILE = path.join(__dirname, "elo-history.json");

function loadEloHistory() {
  try {
    if (!fs.existsSync(ELO_FILE)) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(ELO_FILE, "utf8")
    );
  } catch (error) {
    console.error("Erro ao ler elo-history.json:", error.message);
    return {};
  }
}

function saveEloHistory(data) {
  try {
    fs.writeFileSync(
      ELO_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error("Erro ao guardar histórico de ELO:", error.message);
  }
}

app.get("/api/stats", async (req, res) => {

  try {

    const apiKey = process.env.FACEIT_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "FACEIT_API_KEY não configurada."
      });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    };

    const nickname = "wisde";

    // ==========================
    // ENCONTRAR JOGADOR
    // ==========================

    const playerResponse = await fetch(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`,
      { headers }
    );

    if (!playerResponse.ok) {
      throw new Error(
        `Erro ao procurar jogador: ${playerResponse.status}`
      );
    }

    const player = await playerResponse.json();

    const playerId = player.player_id;

    if (!playerId) {
      throw new Error("Player ID não encontrado.");
    }

    // ==========================
    // ELO ATUAL
    // ==========================

    const currentElo =
      Number(player.games?.cs2?.faceit_elo);

    // ==========================
    // DATAS
    // ==========================

    const now = new Date();

    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const today = now.getUTCDate();

    const startOfMonth = new Date(
      Date.UTC(
        year,
        monthIndex,
        1,
        0,
        0,
        0
      )
    );

    const endOfMonth = new Date(
      Date.UTC(
        year,
        monthIndex + 1,
        1,
        0,
        0,
        0
      )
    );

    const daysInMonth =
      new Date(
        Date.UTC(
          year,
          monthIndex + 1,
          0
        )
      ).getUTCDate();

    /*
     * O próprio dia conta como dia restante.
     *
     * Exemplo:
     * 27 de Agosto:
     *
     * 27,28,29,30,31 = 5 dias
     */

    const daysRemaining =
      Math.max(
        daysInMonth - today + 1,
        0
      );

    const from =
      Math.floor(
        startOfMonth.getTime() / 1000
      );

    const to =
      Math.floor(
        endOfMonth.getTime() / 1000
      );

    const statsFrom =
      startOfMonth.getTime();

    const statsTo =
      endOfMonth.getTime();

    // ==========================
    // HISTÓRICO
    // ==========================

    let matches = [];
    let offset = 0;

    while (true) {

      const matchesResponse = await fetch(
        `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&from=${from}&to=${to}&offset=${offset}&limit=100`,
        { headers }
      );

      if (!matchesResponse.ok) {
        throw new Error(
          `Erro ao obter histórico: ${matchesResponse.status}`
        );
      }

      const matchesData =
        await matchesResponse.json();

      const items =
        matchesData.items || [];

      matches.push(...items);

      if (
        items.length < 100 ||
        matches.length >= (matchesData.total || 0)
      ) {
        break;
      }

      offset += 100;

      if (offset > 1000) {
        break;
      }
    }

    // ==========================
    // REMOVER DUPLICADOS
    // ==========================

    const uniqueMatches = [];

    const seenMatches = new Set();

    for (const match of matches) {

      if (!match.match_id) {
        continue;
      }

      if (seenMatches.has(match.match_id)) {
        continue;
      }

      seenMatches.add(match.match_id);

      uniqueMatches.push(match);
    }

    matches = uniqueMatches;

    // ==========================
    // WINS / LOSSES
    // ==========================

    let wins = 0;
    let losses = 0;

    for (const match of matches) {

      if (match.status !== "finished") {
        continue;
      }

      let playerTeam = null;

      for (
        const [teamId, team]
        of Object.entries(match.teams || {})
      ) {

        const found =
          (team.players || []).some(
            p =>
              p.player_id === playerId
          );

        if (found) {
          playerTeam = teamId;
          break;
        }
      }

      if (!playerTeam) {
        continue;
      }

      if (
        match.results &&
        match.results.winner === playerTeam
      ) {

        wins++;

      } else if (
        match.results &&
        match.results.winner
      ) {

        losses++;

      }
    }

    // ==========================
    // K/D
    // ==========================

    let totalKills = 0;
    let totalDeaths = 0;

    try {

      const statsResponse = await fetch(
        `https://open.faceit.com/data/v4/players/${playerId}/games/cs2/stats?from=${statsFrom}&to=${statsTo}&limit=100`,
        { headers }
      );

      if (statsResponse.ok) {

        const statsData =
          await statsResponse.json();

        const statMatches =
          statsData.items || [];

        for (const item of statMatches) {

          const stats =
            item.stats || {};

          const kills =
            Number(stats["Kills"]);

          const deaths =
            Number(stats["Deaths"]);

          if (Number.isFinite(kills)) {
            totalKills += kills;
          }

          if (Number.isFinite(deaths)) {
            totalDeaths += deaths;
          }
        }
      }

    } catch (error) {

      console.log(
        "Erro ao obter K/D:",
        error.message
      );

    }

    // ==========================
    // FACEIT RATING
    // ==========================

    let totalRating = 0;
    let ratingMatches = 0;

    for (const match of matches) {

      if (match.status !== "finished") {
        continue;
      }

      if (!match.match_id) {
        continue;
      }

      try {

        const matchResponse = await fetch(
          `https://open.faceit.com/data/v4/matches/${match.match_id}/stats`,
          { headers }
        );

        if (!matchResponse.ok) {
          continue;
        }

        const matchData =
          await matchResponse.json();

        const rounds =
          matchData.rounds || [];

        for (const round of rounds) {

          const teams =
            round.teams || [];

          for (const team of teams) {

            const players =
              team.players || [];

            for (const p of players) {

              if (
                p.player_id !== playerId
              ) {
                continue;
              }

              const stats =
                p.player_stats || {};

              const possibleRatingKeys = [
                "Rating",
                "rating",
                "Faceit Rating",
                "FACEIT Rating",
                "Faceit Rating 2.0",
                "Rating 2.0"
              ];

              for (
                const key
                of possibleRatingKeys
              ) {

                if (
                  stats[key] !== undefined
                ) {

                  const rating =
                    Number(stats[key]);

                  if (
                    Number.isFinite(rating)
                  ) {

                    totalRating += rating;
                    ratingMatches++;

                    break;
                  }
                }
              }
            }
          }
        }

      } catch (error) {

        console.log(
          `Erro na partida ${match.match_id}:`,
          error.message
        );

      }
    }

    const averageRating =
      ratingMatches > 0
        ? totalRating / ratingMatches
        : null;

    // ==========================
    // CÁLCULOS
    // ==========================

    const games =
      wins + losses;

    const winRate =
      games > 0
        ? (wins / games) * 100
        : 0;

    const kd =
      totalDeaths > 0
        ? totalKills / totalDeaths
        : 0;

    // ==========================
    // OBJETIVO
    // ==========================

    const goal = 50;

    const winsRemaining =
      Math.max(
        goal - wins,
        0
      );

    const averagePerDay =
      today > 0
        ? wins / today
        : 0;

    const requiredPerDay =
      daysRemaining > 0
        ? winsRemaining / daysRemaining
        : winsRemaining;

    const progress =
      Math.min(
        (wins / goal) * 100,
        100
      );

    // ==========================
    // ELO HOJE / ELO MÊS
    // ==========================

    let eloToday = null;
    let eloMonth = null;

    if (
      Number.isFinite(currentElo)
    ) {

      const eloHistory =
        loadEloHistory();

      const todayKey =
        now.toISOString().slice(0, 10);

      const monthKey =
        `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

      /*
       * Se ainda não existe referência para hoje,
       * guardamos o ELO atual.
       */

      if (
        !eloHistory[todayKey]
      ) {

        eloHistory[todayKey] = {
          startElo: currentElo
        };

      }

      /*
       * Se ainda não existe referência para
       * este mês, guardamos o ELO atual.
       */

      if (
        !eloHistory[monthKey]
      ) {

        eloHistory[monthKey] = {
          startElo: currentElo
        };

      }

      saveEloHistory(eloHistory);

      eloToday =
        currentElo -
        eloHistory[todayKey].startElo;

      eloMonth =
        currentElo -
        eloHistory[monthKey].startElo;
    }

    // ==========================
    // NOME DO MÊS
    // ==========================

    const monthName =
      now.toLocaleString(
        "en-US",
        {
          month: "long",
          timeZone: "UTC"
        }
      );

    // ==========================
    // RESPOSTA
    // ==========================

    res.json({

      nickname:
        player.nickname,

      month:
        monthName,

      year,

      goal,

      wins,
      losses,
      games,

      winsRemaining,

      winRate:
        Number(
          winRate.toFixed(1)
        ),

      kd:
        Number(
          kd.toFixed(2)
        ),

      averageRating:
        averageRating !== null
          ? Number(
              averageRating.toFixed(2)
            )
          : null,

      totalKills,
      totalDeaths,

      ratingMatches,

      averagePerDay:
        Number(
          averagePerDay.toFixed(2)
        ),

      requiredPerDay:
        Number(
          requiredPerDay.toFixed(2)
        ),

      daysRemaining,

      progress:
        Number(
          progress.toFixed(1)
        ),

      // ELO
      currentElo:
        Number.isFinite(currentElo)
          ? currentElo
          : null,

      eloToday,

      eloMonth,

      updatedAt:
        new Date().toISOString(),

      matchesFound:
        matches.length

    });

  } catch (error) {

    console.error(
      "ERRO /api/stats:",
      error
    );

    res.status(500).json({

      error:
        "Não foi possível obter os dados da FACEIT.",

      details:
        error.message

    });

  }

});

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

});

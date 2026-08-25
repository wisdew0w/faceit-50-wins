const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("."));

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
    // ENCONTRAR O JOGADOR
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

    // ==========================
    // DATAS DO MÊS
    // ==========================

    const now = new Date();

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0
    );

    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      0,
      0,
      0
    );

    // Histórico usa segundos
    const from = Math.floor(
      startOfMonth.getTime() / 1000
    );

    const to = Math.floor(
      endOfMonth.getTime() / 1000
    );

    // Stats usa milissegundos
    const statsFrom =
      startOfMonth.getTime();

    const statsTo =
      endOfMonth.getTime();

    // ==========================
    // HISTÓRICO DE CS2
    // ==========================

    const matchesResponse = await fetch(
      `https://open.faceit.com/data/v4/players/${player.player_id}/history?game=cs2&from=${from}&to=${to}&limit=100`,
      { headers }
    );

    if (!matchesResponse.ok) {
      throw new Error(
        `Erro ao obter histórico: ${matchesResponse.status}`
      );
    }

    const matchesData =
      await matchesResponse.json();

    const matches =
      matchesData.items || [];

    // ==========================
    // VITÓRIAS / DERROTAS
    // ==========================

    let wins = 0;
    let losses = 0;

    for (const match of matches) {

      if (match.status !== "finished") {
        continue;
      }

      let playerTeam = null;

      for (const [teamId, team] of Object.entries(
        match.teams || {}
      )) {

        const found =
          (team.players || []).some(
            p =>
              p.player_id === player.player_id
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
      }

      else if (
        match.results &&
        match.results.winner
      ) {
        losses++;
      }
    }

    // ==========================
    // ESTATÍSTICAS
    // ==========================

    let totalKills = 0;
    let totalDeaths = 0;

    let totalRating = 0;
    let ratingCount = 0;

    try {

      const statsResponse = await fetch(
        `https://open.faceit.com/data/v4/players/${player.player_id}/games/cs2/stats?from=${statsFrom}&to=${statsTo}&limit=100`,
        { headers }
      );

      if (statsResponse.ok) {

        const statsData =
          await statsResponse.json();

        const statMatches =
          statsData.items || [];

        console.log(
          "========================================"
        );

        console.log(
          `STATS FACEIT ENCONTRADAS: ${statMatches.length}`
        );

        console.log(
          "========================================"
        );

        for (const item of statMatches) {

          const stats =
            item.stats || {};

          // MOSTRAR OS CAMPOS DEVOLVIDOS PELA FACEIT
          console.log(
            "STATS FACEIT:",
            JSON.stringify(stats)
          );

          // ==========================
          // KILLS
          // ==========================

          const kills =
            Number(
              stats.Kills ??
              stats.kills
            );

          if (Number.isFinite(kills)) {
            totalKills += kills;
          }

          // ==========================
          // DEATHS
          // ==========================

          const deaths =
            Number(
              stats.Deaths ??
              stats.deaths
            );

          if (Number.isFinite(deaths)) {
            totalDeaths += deaths;
          }

          // ==========================
          // RATING
          // ==========================

          const rating =
            Number(
              stats.Rating ??
              stats.rating
            );

          if (Number.isFinite(rating)) {
            totalRating += rating;
            ratingCount++;
          }
        }

        console.log(
          "========================================"
        );

        console.log(
          `TOTAL KILLS: ${totalKills}`
        );

        console.log(
          `TOTAL DEATHS: ${totalDeaths}`
        );

        console.log(
          `RATING ENCONTRADO: ${ratingCount}`
        );

        console.log(
          "========================================"
        );

      } else {

        console.log(
          `Stats FACEIT indisponíveis: ${statsResponse.status}`
        );

      }

    } catch (statsError) {

      console.log(
        "Erro ao obter estatísticas:",
        statsError.message
      );

    }

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
        : totalKills > 0
          ? totalKills
          : 0;

    const averageRating =
      ratingCount > 0
        ? totalRating / ratingCount
        : null;

    // ==========================
    // OBJETIVO
    // ==========================

    const goal = 50;

    const today =
      now.getDate();

    const daysInMonth =
      new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
      ).getDate();

    const daysRemaining =
      Math.max(
        daysInMonth - today + 1,
        0
      );

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
    // RESPOSTA
    // ==========================

    res.json({

      nickname:
        player.nickname,

      month:
        now.toLocaleString(
          "en-US",
          {
            month: "long"
          }
        ),

      year:
        now.getFullYear(),

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

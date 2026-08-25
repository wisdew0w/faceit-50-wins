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

    // ==========================
    // INÍCIO E FIM DO MÊS
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

    const from = Math.floor(
      startOfMonth.getTime() / 1000
    );

    const to = Math.floor(
      endOfMonth.getTime() / 1000
    );

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
    // CONTADORES
    // ==========================

    let wins = 0;
    let losses = 0;

    let totalKills = 0;
    let totalDeaths = 0;

    let totalRating = 0;
    let ratingMatches = 0;

    // ==========================
    // PROCESSAR PARTIDAS
    // ==========================

    for (const match of matches) {

      // Só partidas terminadas
      if (match.status !== "finished") {
        continue;
      }

      // --------------------------
      // EQUIPA DO JOGADOR
      // --------------------------

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

      // --------------------------
      // VITÓRIA / DERROTA
      // --------------------------

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

      // --------------------------
      // ESTATÍSTICAS DA PARTIDA
      // --------------------------

      try {

        const statsResponse = await fetch(
          `https://open.faceit.com/data/v4/matches/${match.match_id}/stats`,
          { headers }
        );

        if (!statsResponse.ok) {
          console.log(
            `Não foi possível obter stats da partida ${match.match_id}: ${statsResponse.status}`
          );

          continue;
        }

        const statsData =
          await statsResponse.json();

        const rounds =
          statsData.rounds || [];

        for (const round of rounds) {

          const teams =
            round.teams || [];

          for (const team of teams) {

            const players =
              team.players || [];

            for (const p of players) {

              if (
                p.player_id !==
                player.player_id
              ) {
                continue;
              }

              const stats =
                p.player_stats || {};

              // --------------------------
              // KILLS
              // --------------------------

              const kills =
                Number(stats["Kills"]);

              if (Number.isFinite(kills)) {
                totalKills += kills;
              }

              // --------------------------
              // DEATHS
              // --------------------------

              const deaths =
                Number(stats["Deaths"]);

              if (Number.isFinite(deaths)) {
                totalDeaths += deaths;
              }

              // --------------------------
              // RATING
              // --------------------------

              const possibleRatings = [
                stats["Rating"],
                stats["rating"],
                stats["Faceit Rating"],
                stats["FACEIT Rating"],
                stats["Faceit Rating 2.0"],
                stats["Rating 2.0"]
              ];

              const rating =
                possibleRatings
                  .map(value => Number(value))
                  .find(value => Number.isFinite(value));

              if (
                rating !== undefined
              ) {
                totalRating += rating;
                ratingMatches++;
              }
            }
          }
        }

      } catch (statsError) {

        console.log(
          `Erro nas stats da partida ${match.match_id}:`,
          statsError.message
        );

      }
    }

    // ==========================
    // ESTATÍSTICAS FINAIS
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
      ratingMatches > 0
        ? totalRating / ratingMatches
        : 0;

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

    // Inclui o próprio dia
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
          { month: "long" }
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

      // NOVO
      kd:
        Number(
          kd.toFixed(2)
        ),

      // NOVO
      averageRating:
        ratingMatches > 0
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

      updatedAt:
        new Date().toISOString(),

      matchesFound:
        matches.length
    });

  } catch (error) {

    console.error(error);

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

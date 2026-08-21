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

    // Encontrar o jogador
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

    // Início e fim do mês atual
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

    // Histórico de CS2
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

    let wins = 0;
    let losses = 0;

    // Contar vitórias e derrotas
    for (const match of matches) {

      // Só partidas terminadas
      if (match.status !== "finished") {
        continue;
      }

      // Procurar em que equipa está o jogador
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

      // O vencedor vem identificado pelo ID da equipa
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

    const games = wins + losses;

    const winRate =
      games > 0
        ? (wins / games) * 100
        : 0;

    // Objetivo padrão
    // O objetivo escolhido no site é tratado pelo frontend.
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
        daysInMonth - today,
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

    res.json({
      nickname: player.nickname,

      month: now.toLocaleString(
        "en-US",
        { month: "long" }
      ),

      year: now.getFullYear(),

      goal,

      wins,
      losses,
      games,

      winsRemaining,

      winRate:
        Number(
          winRate.toFixed(1)
        ),

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

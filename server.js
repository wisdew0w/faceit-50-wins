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

    const nickname = "wisde";

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    };

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

    // Início do mês
    const now = new Date();

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

    const startTimestamp = Math.floor(
      startOfMonth.getTime() / 1000
    );

    // Obter histórico de partidas do jogador
    const matchesResponse = await fetch(
      `https://open.faceit.com/data/v4/players/${player.player_id}/history?game=cs2&from=${startTimestamp}&limit=100`,
      { headers }
    );

    if (!matchesResponse.ok) {
      throw new Error(
        `Erro ao obter partidas: ${matchesResponse.status}`
      );
    }

    const matchesData = await matchesResponse.json();

    const matches = matchesData.items || [];

    let wins = 0;
    let losses = 0;

    // Verificar cada partida
    for (const match of matches) {

      if (!match.match_id) {
        continue;
      }

      const matchResponse = await fetch(
        `https://open.faceit.com/data/v4/matches/${match.match_id}`,
        { headers }
      );

      if (!matchResponse.ok) {
        continue;
      }

      const matchData = await matchResponse.json();

      const playerFaction =
        matchData.teams?.faction1?.players?.some(
          p => p.player_id === player.player_id
        )
          ? "faction1"
          : matchData.teams?.faction2?.players?.some(
              p => p.player_id === player.player_id
            )
          ? "faction2"
          : null;

      if (!playerFaction) {
        continue;
      }

      if (matchData.results?.winner === playerFaction) {
        wins++;
      } else {
        losses++;
      }
    }

    const games = wins + losses;

    const winRate =
      games > 0
        ? (wins / games) * 100
        : 0;

    const goal = 50;

    const today = now.getDate();

    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();

    const daysRemaining =
      Math.max(daysInMonth - today, 0);

    const winsRemaining =
      Math.max(goal - wins, 0);

    const averagePerDay =
      today > 0
        ? wins / today
        : 0;

    const requiredPerDay =
      daysRemaining > 0
        ? winsRemaining / daysRemaining
        : winsRemaining;

    const progress =
      Math.min((wins / goal) * 100, 100);

    res.json({
      nickname: player.nickname,
      month: now.toLocaleString("en-US", {
        month: "long"
      }),
      year: now.getFullYear(),

      goal,
      wins,
      losses,
      games,

      winsRemaining,

      winRate: Number(winRate.toFixed(1)),

      averagePerDay:
        Number(averagePerDay.toFixed(2)),

      requiredPerDay:
        Number(requiredPerDay.toFixed(2)),

      daysRemaining,

      progress:
        Number(progress.toFixed(1)),

      updatedAt:
        new Date().toISOString()
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Não foi possível obter os dados da FACEIT.",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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

    // Procurar o jogador
    const playerResponse = await fetch(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!playerResponse.ok) {
      throw new Error(`FACEIT player API: ${playerResponse.status}`);
    }

    const player = await playerResponse.json();

    // Início e fim do mês atual
    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    );

    const from = Math.floor(startOfMonth.getTime() / 1000);
    const to = Math.floor(endOfMonth.getTime() / 1000);

    // Histórico de partidas
    const matchesResponse = await fetch(
      `https://open.faceit.com/data/v4/players/${player.player_id}/games/cs2/matches?from=${from}&to=${to}&limit=100`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!matchesResponse.ok) {
      throw new Error(`FACEIT matches API: ${matchesResponse.status}`);
    }

    const matchesData = await matchesResponse.json();

    const matches = matchesData.items || [];

    let wins = 0;
    let losses = 0;

    for (const match of matches) {
      if (match.results?.winner === "faction1") {
        wins++;
      } else if (match.results?.winner === "faction2") {
        losses++;
      }
    }

    const games = wins + losses;
    const winRate = games > 0 ? (wins / games) * 100 : 0;

    const goal = 50;

    const today = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();

    const daysRemaining = Math.max(daysInMonth - today, 0);

    const averagePerDay =
      today > 0 ? wins / today : 0;

    const winsRemaining = Math.max(goal - wins, 0);

    const requiredPerDay =
      daysRemaining > 0
        ? winsRemaining / daysRemaining
        : winsRemaining;

    res.json({
      nickname: player.nickname,
      month: now.toLocaleString("en-US", { month: "long" }),
      year: now.getFullYear(),
      goal,
      wins,
      losses,
      games,
      winsRemaining,
      winRate: Number(winRate.toFixed(1)),
      averagePerDay: Number(averagePerDay.toFixed(2)),
      requiredPerDay: Number(requiredPerDay.toFixed(2)),
      daysRemaining,
      progress: Number(
        Math.min((wins / goal) * 100, 100).toFixed(1)
      ),
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Não foi possível obter os dados da FACEIT."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

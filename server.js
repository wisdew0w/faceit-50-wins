```javascript
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

    /*
     * ---------------------------------------------------------
     * 1. Get player information
     * ---------------------------------------------------------
     */

    const playerResponse = await fetch(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`,
      {
        headers
      }
    );

    if (!playerResponse.ok) {
      throw new Error(
        `FACEIT player API error: ${playerResponse.status}`
      );
    }

    const player = await playerResponse.json();

    const playerId = player.player_id;

    if (!playerId) {
      throw new Error("Player ID não encontrado.");
    }

    /*
     * ---------------------------------------------------------
     * 2. Current month dates
     * ---------------------------------------------------------
     */

    const now = new Date();

    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const currentDay = now.getUTCDate();

    const daysInMonth =
      new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    /*
     * IMPORTANT:
     *
     * The current day counts as one of the remaining days.
     *
     * Example:
     * August 24 -> August has 31 days
     * 24,25,26,27,28,29,30,31 = 8 days
     *
     * Therefore:
     * daysRemaining = 31 - 24 + 1 = 8
     */

    const daysRemaining =
      Math.max(daysInMonth - currentDay + 1, 0);

    /*
     * ---------------------------------------------------------
     * 3. Start / end of current month
     * ---------------------------------------------------------
     */

    const startOfMonth = new Date(
      Date.UTC(year, monthIndex, 1, 0, 0, 0)
    );

    const endOfMonth = new Date(
      Date.UTC(year, monthIndex + 1, 1, 0, 0, 0)
    );

    const fromTimestamp =
      Math.floor(startOfMonth.getTime() / 1000);

    const toTimestamp =
      Math.floor(endOfMonth.getTime() / 1000);

    /*
     * ---------------------------------------------------------
     * 4. Get player's match history
     * ---------------------------------------------------------
     */

    let allMatches = [];
    let offset = 0;

    const limit = 100;

    while (true) {

      const historyResponse = await fetch(
        `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&from=${fromTimestamp}&to=${toTimestamp}&offset=${offset}&limit=${limit}`,
        {
          headers
        }
      );

      if (!historyResponse.ok) {
        throw new Error(
          `FACEIT history API error: ${historyResponse.status}`
        );
      }

      const history = await historyResponse.json();

      const matches = history.items || [];

      allMatches.push(...matches);

      if (
        matches.length < limit ||
        !history.start ||
        allMatches.length >= history.total
      ) {
        break;
      }

      offset += limit;
    }

    /*
     * ---------------------------------------------------------
     * 5. Remove duplicate matches
     * ---------------------------------------------------------
     */

    const uniqueMatches = [];

    const seenMatches = new Set();

    for (const match of allMatches) {

      const matchId = match.match_id;

      if (!matchId) {
        continue;
      }

      if (seenMatches.has(matchId)) {
        continue;
      }

      seenMatches.add(matchId);

      uniqueMatches.push(match);
    }

    /*
     * ---------------------------------------------------------
     * 6. Get result + kills/deaths for every match
     * ---------------------------------------------------------
     */

    let wins = 0;
    let losses = 0;

    let totalKills = 0;
    let totalDeaths = 0;

    for (const match of uniqueMatches) {

      const matchId = match.match_id;

      try {

        const statsResponse = await fetch(
          `https://open.faceit.com/data/v4/matches/${matchId}/stats`,
          {
            headers
          }
        );

        if (!statsResponse.ok) {
          continue;
        }

        const matchStats = await statsResponse.json();

        const rounds = matchStats.rounds || [];

        let playerFound = false;

        for (const round of rounds) {

          const teams = round.teams || [];

          for (const team of teams) {

            const players = team.players || [];

            for (const p of players) {

              if (p.player_id !== playerId) {
                continue;
              }

              playerFound = true;

              /*
               * Result
               */

              const teamStats = team.team_stats || {};

              const winner = teamStats["Winner"];

              if (winner === "1") {
                wins++;
              } else if (winner === "0") {
                losses++;
              }

              /*
               * Kills / deaths
               */

              const stats = p.player_stats || {};

              const kills =
                Number(stats.Kills || 0);

              const deaths =
                Number(stats.Deaths || 0);

              totalKills += kills;
              totalDeaths += deaths;

            }
          }
        }

        /*
         * If the match stats did not contain the player,
         * don't count it.
         */

        if (!playerFound) {
          continue;
        }

      } catch (error) {

        console.error(
          `Error processing match ${matchId}:`,
          error.message
        );

      }
    }

    /*
     * ---------------------------------------------------------
     * 7. Calculate statistics
     * ---------------------------------------------------------
     */

    const games = wins + losses;

    const winRate =
      games > 0
        ? (wins / games) * 100
        : 0;

    const kd =
      totalDeaths > 0
        ? totalKills / totalDeaths
        : totalKills;

    /*
     * Average wins per day:
     *
     * IMPORTANT:
     * The current day is included.
     *
     * Example:
     * 5 wins on August 24
     *
     * average = 5 / 24
     */

    const averagePerDay =
      currentDay > 0
        ? wins / currentDay
        : 0;

    const goal = 50;

    const winsRemaining =
      Math.max(goal - wins, 0);

    /*
     * Required wins per remaining day.
     */

    const requiredPerDay =
      daysRemaining > 0
        ? winsRemaining / daysRemaining
        : winsRemaining;

    const progress =
      (wins / goal) * 100;

    /*
     * ---------------------------------------------------------
     * 8. Month name
     * ---------------------------------------------------------
     */

    const monthName = new Intl.DateTimeFormat(
      "en-US",
      {
        month: "long",
        timeZone: "UTC"
      }
    ).format(now);

    /*
     * ---------------------------------------------------------
     * 9. Send response
     * ---------------------------------------------------------
     */

    res.json({

      nickname,

      month: monthName,
      year,

      goal,

      wins,
      losses,
      games,

      winsRemaining,

      winRate,

      kd,

      totalKills,
      totalDeaths,

      averagePerDay,

      requiredPerDay,

      daysRemaining,

      progress,

      updatedAt: now.toISOString()

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: error.message || "Erro ao obter dados da FACEIT."
    });

  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

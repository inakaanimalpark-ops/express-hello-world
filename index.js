const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
console.log("=== VER1.5 FINAL ===");

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ===== メモリDB =====
const userState = new Map();

function resetUser(userId) {
  userState.set(userId, { step: "WAIT_GENDER", birth: {} });
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// ===== LINE reply =====
async function reply(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

// ===== QuickReplies =====
const qrGender = {
  items: ["男性", "女性", "その他"].map(v => ({
    type: "action",
    action: { type: "message", label: v, text: v },
  })),
};

const qrEra = {
  items: [
    { label: "1970年代", text: "ERA:1970" },
    { label: "1980年代", text: "ERA:1980" },
    { label: "1990年代", text: "ERA:1990" },
    { label: "2000年代", text: "ERA:2000" },
    { label: "2010年代", text: "ERA:2010" },
  ].map(v => ({
    type: "action",
    action: { type: "message", label: v.label, text: v.text },
  })),
};

function qrYears(start) {
  return {
    items: Array.from({ length: 10 }, (_, i) => {
      const y = start + i;
      return {
        type: "action",
        action: { type: "message", label: `${y}`, text: `Y:${y}` },
      };
    }),
  };
}

function qrMonths() {
  return {
    items: Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return {
        type: "action",
        action: { type: "message", label: `${m}月`, text: `M:${m}` },
      };
    }),
  };
}

function qrDays(max) {
  return {
    items: Array.from({ length: Math.min(12, max) }, (_, i) => {
      const d = i + 1;
      return {
        type: "action",
        action: { type: "message", label: `${d}`, text: `D:${d}` },
      };
    }),
  };
}

const qrNext = {
  items: [{ type: "action", action: { type: "message", label: "次へ", text: "次へ" } }],
};

// ===== 無料鑑定 =====
function freeParts(gender, birth) {
  return [
    `無料鑑定を始めます。\n性別：${gender}\n生年月日：${birth}`,
    `あなたは芯が強く、周囲に流されにくい方です。`,
    `最近は気を使いすぎて少し疲れ気味のようです。`,
    `無料鑑定は以上です。`,
  ];
}

// ===== Routes =====
app.get("/", (_, res) => res.send("VER1.5 OK"));

app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  res.send("OK");

  for (const e of req.body.events || []) {
    const userId = e.source?.userId;
    const replyToken = e.replyToken;
    if (!userId || !replyToken) continue;

    if (e.type === "follow") {
      resetUser(userId);
      await reply(replyToken, [{
        type: "text",
        text: "ようこそ。性別を教えてください。",
        quickReply: qrGender,
      }]);
      continue;
    }

    if (e.type !== "message" || e.message.type !== "text") continue;

    const text = e.message.text.trim();
    const st = userState.get(userId) || resetUser(userId) || userState.get(userId);

    if (text === "最初から") {
      resetUser(userId);
      await reply(replyToken, [{
        type: "text",
        text: "最初から始めます。性別を教えてください。",
        quickReply: qrGender,
      }]);
      continue;
    }

    if (st.step === "WAIT_GENDER") {
      st.gender = text;
      st.step = "WAIT_ERA";
      await reply(replyToken, [{
        type: "text",
        text: "生まれた年代を選んでください。",
        quickReply: qrEra,
      }]);
      continue;
    }

    if (st.step === "WAIT_ERA" && text.startsWith("ERA:")) {
      st.era = Number(text.split(":")[1]);
      st.step = "WAIT_YEAR";
      await reply(replyToken, [{
        type: "text",
        text: "年を選んでください。",
        quickReply: qrYears(st.era),
      }]);
      continue;
    }

    if (st.step === "WAIT_YEAR" && text.startsWith("Y:")) {
      st.birth.year = Number(text.slice(2));
      st.step = "WAIT_MONTH";
      await reply(replyToken, [{
        type: "text",
        text: "月を選んでください。",
        quickReply: qrMonths(),
      }]);
      continue;
    }

    if (st.step === "WAIT_MONTH" && text.startsWith("M:")) {
      st.birth.month = Number(text.slice(2));
      st.step = "WAIT_DAY";
      await reply(replyToken, [{
        type: "text",
        text: "日を選んでください（13〜31は直接入力OK）",
        quickReply: qrDays(daysInMonth(st.birth.year, st.birth.month)),
      }]);
      continue;
    }

    if (st.step === "WAIT_DAY") {
      let day = text.startsWith("D:") ? Number(text.slice(2)) : Number(text);
      const max = daysInMonth(st.birth.year, st.birth.month);

      if (!day || day < 1 || day > max) {
        await reply(replyToken, [{ type: "text", text: `1〜${max}で入力してください。` }]);
        continue;
      }

      st.birth.full = `${st.birth.year}-${String(st.birth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      st.step = "FREE_0";
      st.free = freeParts(st.gender, st.birth.full);

      await reply(replyToken, [{
        type: "text",
        text: st.free[0],
        quickReply: qrNext,
      }]);
      continue;
    }

    if (st.step.startsWith("FREE_")) {
      const idx = Number(st.step.split("_")[1]);
      if (text !== "次へ") continue;

      if (idx + 1 >= st.free.length) {
        st.step = "DONE";
        await reply(replyToken, [{
          type: "text",
          text: "ここから先は有料鑑定となります。\n（現在準備中です）\n\n「最初から」で再度体験できます。",
        }]);
      } else {
        st.step = `FREE_${idx + 1}`;
        await reply(replyToken, [{
          type: "text",
          text: st.free[idx + 1],
          quickReply: qrNext,
        }]);
      }
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running"));

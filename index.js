const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

console.log("=== VER1 FINAL STABLE ===");

const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
const channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();

// ===== メモリDB =====
const userStateMap = new Map();

function getUserId(event) {
  return event?.source?.userId;
}

function resetUser(userId) {
  userStateMap.set(userId, { step: "WAIT_GENDER", birth: {} });
}

// ===== 日付 =====
function isValidBirth(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() + 1 === m &&
    dt.getDate() === d
  );
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ===== LINE返信 =====
async function reply(replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    console.error("LINE ERROR:", await res.text());
  }
}

// ===== クイックリプライ =====
function quickGender() {
  return {
    items: ["男性", "女性", "その他"].map(v => ({
      type: "action",
      action: { type: "message", label: v, text: v },
    })),
  };
}

function quickYears(start) {
  return {
    items: Array.from({ length: 10 }, (_, i) => {
      const y = start + i;
      return { type: "action", action: { type: "message", label: `${y}`, text: `Y:${y}` } };
    }),
  };
}

function quickMonths() {
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

function quickDays(max) {
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

// ===== テンプレ =====
function freeParts({ gender, birth }) {
  return [
    `無料鑑定を始めます。\n\n性別：${gender}\n生年月日：${birth}`,
    `あなたは芯が強く、流されにくいタイプです。`,
    `最近は少し無理をしがち。\n自分の本音を大切に。`,
    `無料鑑定はここまでです。`,
  ];
}

// ===== 疎通 =====
app.get("/", (_, res) => res.send("VER1 OK"));

// ===== Webhook =====
app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  res.send("OK");

  for (const event of req.body.events || []) {
    const replyToken = event.replyToken;
    const userId = getUserId(event);
    if (!replyToken || !userId) continue;

    if (event.type === "follow") {
      resetUser(userId);
      await reply(replyToken, [{
        type: "text",
        text: "友だち追加ありがとうございます。\n性別を教えてください。",
        quickReply: quickGender(),
      }]);
      continue;
    }

    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    if (!userStateMap.has(userId)) resetUser(userId);
    const st = userStateMap.get(userId);

    if (text === "最初から") {
      resetUser(userId);
      await reply(replyToken, [{
        type: "text",
        text: "最初から始めます。\n性別を教えてください。",
        quickReply: quickGender(),
      }]);
      continue;
    }

    // 性別
    if (st.step === "WAIT_GENDER") {
      if (!["男性", "女性", "その他"].includes(text)) {
        await reply(replyToken, [{
          type: "text",
          text: "性別を選んでください。",
          quickReply: quickGender(),
        }]);
        continue;
      }
      st.gender = text;
      st.step = "WAIT_YEAR";
      await reply(replyToken, [{
        type: "text",
        text: "生まれた年を選んでください（1990〜1999など）",
        quickReply: quickYears(1990),
      }]);
      continue;
    }

    // 年
    if (st.step === "WAIT_YEAR" && text.startsWith("Y:")) {
      st.birth.year = Number(text.slice(2));
      st.step = "WAIT_MONTH";
      await reply(replyToken, [{
        type: "text",
        text: "月を選んでください。",
        quickReply: quickMonths(),
      }]);
      continue;
    }

    // 月
    if (st.step === "WAIT_MONTH" && text.startsWith("M:")) {
      st.birth.month = Number(text.slice(2));
      st.step = "WAIT_DAY";
      const max = daysInMonth(st.birth.year, st.birth.month);
      await reply(replyToken, [{
        type: "text",
        text: "日を選んでください（13〜31はそのまま数字入力OK）",
        quickReply: quickDays(max),
      }]);
      continue;
    }

    // 日（ボタン or 直接入力）
    if (st.step === "WAIT_DAY") {
      let day = null;
      if (text.startsWith("D:")) day = Number(text.slice(2));
      else if (/^\d{1,2}$/.test(text)) day = Number(text);

      const max = daysInMonth(st.birth.year, st.birth.month);
      if (!day || day < 1 || day > max) {
        await reply(replyToken, [{ type: "text", text: `1〜${max} の数字を入力してください。` }]);
        continue;
      }

      const birth = `${st.birth.year}-${String(st.birth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      st.birth = birth;
      st.step = "FREE_0";

      const parts = freeParts({ gender: st.gender, birth });
      await reply(replyToken, [{
        type: "text",
        text: parts[0],
        quickReply: { items: [{ type: "action", action: { type: "message", label: "次へ", text: "次へ" } }] },
      }]);
      continue;
    }

    // 無料鑑定
    if (st.step.startsWith("FREE_")) {
      const idx = Number(st.step.split("_")[1]);
      if (text !== "次へ") continue;

      if (idx + 1 >= freeParts({}).length) {
        st.step = "DONE";
        await reply(replyToken, [{ type: "text", text: "無料鑑定は以上です。" }]);
      } else {
        st.step = `FREE_${idx + 1}`;
        await reply(replyToken, [{
          type: "text",
          text: freeParts({ gender: st.gender, birth: st.birth })[idx + 1],
          quickReply: { items: [{ type: "action", action: { type: "message", label: "次へ", text: "次へ" } }] },
        }]);
      }
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running"));

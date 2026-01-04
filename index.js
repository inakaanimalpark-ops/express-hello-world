const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

console.log("=== VER1 CODE ACTIVE 2026-01-04 ===");

const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
const channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();

// ===== 簡易メモリDB =====
const userStateMap = new Map();

function getUserId(event) {
  return event?.source?.userId || null;
}

function resetUser(userId) {
  userStateMap.set(userId, { step: "WAIT_GENDER", birth: {} });
}

// ===== 日付ユーティリティ =====
function isValidBirth(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() + 1 === m &&
    dt.getDate() === d
  );
}

function daysInMonth(year, monthStr) {
  const m = Number(monthStr); // 1-12
  return new Date(year, m, 0).getDate(); // 正しい当月末日
}

// ===== LINE Reply（HTTP直投げ）=====
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
    console.error("LINE Reply Error:", await res.text());
  }
}

// ===== クイックリプライ =====
function quickReplyGender() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "男性", text: "男性" } },
      { type: "action", action: { type: "message", label: "女性", text: "女性" } },
      { type: "action", action: { type: "message", label: "その他", text: "その他" } },
    ],
  };
}

function quickReplyNext() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "次へ", text: "次へ" } },
      { type: "action", action: { type: "message", label: "最初から", text: "最初から" } },
    ],
  };
}

function quickReplyYearRange() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "1970-79", text: "YRANGE:1970" } },
      { type: "action", action: { type: "message", label: "1980-89", text: "YRANGE:1980" } },
      { type: "action", action: { type: "message", label: "1990-99", text: "YRANGE:1990" } },
      { type: "action", action: { type: "message", label: "2000-09", text: "YRANGE:2000" } },
      { type: "action", action: { type: "message", label: "2010-19", text: "YRANGE:2010" } },
      { type: "action", action: { type: "message", label: "その他", text: "BIRTH_TEXT" } },
    ],
  };
}

function quickReplyYears(start) {
  const items = [];
  for (let y = start; y < start + 10; y++) {
    items.push({ type: "action", action: { type: "message", label: String(y), text: `Y:${y}` } });
  }
  return { items };
}

function quickReplyMonths() {
  const items = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    items.push({ type: "action", action: { type: "message", label: `${m}月`, text: `M:${mm}` } });
  }
  return { items };
}

function quickReplyDays(max) {
  const items = [];
  for (let d = 1; d <= Math.min(12, max); d++) {
    const dd = String(d).padStart(2, "0");
    items.push({ type: "action", action: { type: "message", label: String(d), text: `D:${dd}` } });
  }
  items.push({ type: "action", action: { type: "message", label: "13以降は入力", text: "DAY_TEXT" } });
  return { items };
}

// ===== 無料鑑定テンプレ =====
function freeParts({ gender, birth }) {
  return [
    `ようこそ。\n無料で簡易鑑定を行います。\n\n性別：${gender}\n生年月日：${birth}`,
    `あなたは芯の強いタイプ。\n迷いながらも前に進める力があります。`,
    `最近は少し無理をしがち。\n自分の本音を大切にすると流れが整います。`,
    `無料鑑定はここまでです。\nさらに詳しく見ることもできます。`,
  ];
}

// ===== 疎通確認 =====
app.get("/", (req, res) => res.send("VER1 OK"));

// ===== Webhook =====
app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  res.send("OK");

  const events = req.body.events || [];

  for (const event of events) {
    const replyToken = event.replyToken;
    const userId = getUserId(event);

    if (!replyToken || !userId) continue;

    // 友だち追加
    if (event.type === "follow") {
      resetUser(userId);
      await reply(replyToken, [{
        type: "text",
        text: "友だち追加ありがとうございます。\n性別を教えてください。",
        quickReply: quickReplyGender(),
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
        quickReply: quickReplyGender(),
      }]);
      continue;
    }

    // 性別
    if (st.step === "WAIT_GENDER") {
      if (!["男性", "女性", "その他"].includes(text)) {
        await reply(replyToken, [{
          type: "text",
          text: "性別を選んでください。",
          quickReply: quickReplyGender(),
        }]);
        continue;
      }

      st.gender = text;
      st.step = "WAIT_BIRTH";
      st.birth = {};
      await reply(replyToken, [{
        type: "text",
        text: "年代を選んでください。",
        quickReply: quickReplyYearRange(),
      }]);
      continue;
    }

    // 生年月日
    if (st.step === "WAIT_BIRTH") {
      if (text.startsWith("YRANGE:")) {
        st.birth.range = Number(text.split(":")[1]);
        await reply(replyToken, [{
          type: "text",
          text: "年を選んでください。",
          quickReply: quickReplyYears(st.birth.range),
        }]);
        continue;
      }

      if (text.startsWith("Y:")) {
        st.birth.year = Number(text.split(":")[1]);
        await reply(replyToken, [{
          type: "text",
          text: "月を選んでください。",
          quickReply: quickReplyMonths(),
        }]);
        continue;
      }

      if (text.startsWith("M:")) {
        if (!st.birth.year) {
          await reply(replyToken, [{
            type: "text",
            text: "先に年を選んでください。",
            quickReply: quickReplyYearRange(),
          }]);
          continue;
        }

        st.birth.month = text.split(":")[1];
        const max = daysInMonth(st.birth.year, st.birth.month);

        await reply(replyToken, [{
          type: "text",
          text: "日を選んでください。",
          quickReply: quickReplyDays(max),
        }]);
        continue;
      }

      if (text.startsWith("D:")) {
        const day = text.split(":")[1];
        const birth = `${st.birth.year}-${st.birth.month}-${day}`;
        st.birth = birth;
        st.step = "FREE_0";
        const parts = freeParts({ gender: st.gender, birth });
        await reply(replyToken, [{
          type: "text",
          text: parts[0],
          quickReply: quickReplyNext(),
        }]);
        continue;
      }

      if (text === "DAY_TEXT") {
        st.step = "WAIT_DAY_TEXT";
        await reply(replyToken, [{
          type: "text",
          text: "日付（01〜31）を入力してください。",
        }]);
        continue;
      }
    }

    if (st.step === "WAIT_DAY_TEXT") {
      const day = text;
      const birth = `${st.birth.year}-${st.birth.month}-${day}`;
      if (!isValidBirth(birth)) {
        await reply(replyToken, [{ type: "text", text: "正しい日付を入力してください。" }]);
        continue;
      }

      st.birth = birth;
      st.step = "FREE_0";
      const parts = freeParts({ gender: st.gender, birth });
      await reply(replyToken, [{
        type: "text",
        text: parts[0],
        quickReply: quickReplyNext(),
      }]);
      continue;
    }

    if (st.step.startsWith("FREE_")) {
      if (text !== "次へ") {
        await reply(replyToken, [{
          type: "text",
          text: "「次へ」を押してください。",
          quickReply: quickReplyNext(),
        }]);
        continue;
      }

      const idx = Number(st.step.split("_")[1]);
      const parts = freeParts({ gender: st.gender, birth: st.birth });

      if (idx + 1 >= parts.length) {
        st.step = "DONE";
        await reply(replyToken, [{
          type: "text",
          text: "無料鑑定は以上です。",
        }]);
      } else {
        st.step = `FREE_${idx + 1}`;
        await reply(replyToken, [{
          type: "text",
          text: parts[idx + 1],
          quickReply: quickReplyNext(),
        }]);
      }
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

console.log("=== VER1 CODE ACTIVE 2026-01-04 ===");

const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
const channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();

// ---- 超簡易DB（メモリ） ----
const userStateMap = new Map();

function getUserId(event) {
  return event?.source?.userId || null;
}

function resetUser(userId) {
  userStateMap.set(userId, { step: "WAIT_GENDER" });
}

function isValidBirth(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(`${s}T00:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

// ---- LINE Reply API 直投げ ----
async function reply(replyToken, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    console.error("LINE Reply API failed:", resp.status, bodyText);
  }
}

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

function freeParts({ gender, birth }) {
  return [
    `ユーザーさん、ようこそ。\nまずは無料で「オーラの傾向」を簡易鑑定します。\n\n性別：${gender}\n生年月日：${birth}\n\n深呼吸して、肩の力を抜いてください。`,
    `あなたのオーラは「静かに芯が強い」タイプ。\n\n周囲に合わせ過ぎて疲れやすい一方で、決めたことは最後までやり切る粘りがあります。\n迷いが出たときほど、直感が働く方です。`,
    `最近は「気を使い過ぎ」から運気が散りやすい時期。\n\n本音を飲み込み続けると、判断が鈍ってしまいます。\n小さくても「自分の希望」を言語化すると、流れが整います。`,
    `ここまでが無料鑑定です。\n\nこの先は、お悩みに合わせてもう一段深く読み解けます。\n（恋愛・仕事・金運・生活など）\n\n必要なら、次に進みましょう。`,
  ];
}

// 疎通確認（これ1回だけ）
app.get("/", (req, res) => res.status(200).send("VER1-GENDER-BIRTH-20260104"));

// Webhook
app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  // 先に200
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    console.log("events length:", events.length);

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const userId = getUserId(event);
      const replyToken = event.replyToken;
      const text = (event.message.text || "").trim();

      if (!replyToken) continue;

      // userIdが取れない場合の最低限
      if (!userId) {
        await reply(replyToken, [{ type: "text", text: "受信しました。" }]);
        continue;
      }

      // 初回
      if (!userStateMap.has(userId)) resetUser(userId);
      const st = userStateMap.get(userId);

      // 共通コマンド
      if (text === "最初から") {
        resetUser(userId);
        await reply(replyToken, [
          { type: "text", text: "最初から始めます。\n性別を教えてください。", quickReply: quickReplyGender() },
        ]);
        continue;
      }

      // ここが「受信OK」ではなく会話導線になるポイント
      if (st.step === "WAIT_GENDER") {
        if (!["男性", "女性", "その他"].includes(text)) {
          await reply(replyToken, [
            { type: "text", text: "性別をボタンから選んでください。", quickReply: quickReplyGender() },
          ]);
          continue;
        }
        st.gender = text;
        st.step = "WAIT_BIRTH";
        userStateMap.set(userId, st);

        await reply(replyToken, [
          { type: "text", text: "次に、生年月日を入力してください。\n例）1990-01-31" },
        ]);
        continue;
      }

      if (st.step === "WAIT_BIRTH") {
        if (!isValidBirth(text)) {
          await reply(replyToken, [
            { type: "text", text: "形式が違うようです。\n例）1990-01-31 の形で送ってください。" },
          ]);
          continue;
        }
        st.birth = text;
        st.step = "FREE_0";
        userStateMap.set(userId, st);

        const parts = freeParts({ gender: st.gender, birth: st.birth });

        await reply(replyToken, [
          { type: "text", text: parts[0], quickReply: quickReplyNext() },
        ]);
        continue;
      }

      if (st.step.startsWith("FREE_")) {
        if (text !== "次へ") {
          await reply(replyToken, [
            { type: "text", text: "「次へ」で進めます。", quickReply: quickReplyNext() },
          ]);
          continue;
        }

        const idx = Number(st.step.split("_")[1] || "0");
        const parts = freeParts({ gender: st.gender, birth: st.birth });
        const nextIdx = idx + 1;

        if (nextIdx >= parts.length) {
          st.step = "DONE";
          userStateMap.set(userId, st);

          await reply(replyToken, [
            {
              type: "text",
              text:
                "無料鑑定は以上です。\n\nこのあと有料で、悩みに合わせて深掘り鑑定も可能です。\n（準備中：恋愛/仕事/金運/生活）\n\n続ける場合は「最初から」と送ってください。",
              quickReply: quickReplyNext(),
            },
          ]);
          continue;
        }

        st.step = `FREE_${nextIdx}`;
        userStateMap.set(userId, st);

        await reply(replyToken, [
          { type: "text", text: parts[nextIdx], quickReply: quickReplyNext() },
        ]);
        continue;
      }

      if (st.step === "DONE") {
        await reply(replyToken, [
          { type: "text", text: "続ける場合は「最初から」と送ってください。", quickReply: quickReplyNext() },
        ]);
        continue;
      }

      // 不明ならリセット
      resetUser(userId);
      await reply(replyToken, [
        { type: "text", text: "状態が不明になったため最初から始めます。\n性別を教えてください。", quickReply: quickReplyGender() },
      ]);
    }
  } catch (err) {
    console.error("webhook handler error:", err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));

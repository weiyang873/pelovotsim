// chatService.js - streaming chat completion

async function streamChatCompletion(messages, onChunk) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      stream: true,
      messages
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const text = parsed.delta?.text || parsed?.content_block?.text || "";
        if (text) onChunk(text);
      } catch (_) {}
    }
  }
}

module.exports = { streamChatCompletion };

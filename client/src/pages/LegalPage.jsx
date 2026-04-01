import { useEffect, useState } from "react";

function renderInline(text, keyPrefix) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match = regex.exec(text);
  let tokenIndex = 0;

  while (match) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex}`;
    if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key}
          style={{
            fontFamily: "'SFMono-Regular', Consolas, monospace",
            fontSize: "0.95em",
            padding: "1px 5px",
            borderRadius: 6,
            background: "rgba(148,163,184,0.18)",
            color: "#dbeafe"
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
    tokenIndex += 1;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function toParagraph(lines, key) {
  const text = lines.join(" ").trim();
  if (!text) return null;
  return (
    <p key={key} style={{ margin: "0 0 18px", lineHeight: 1.85, color: "rgba(255,255,255,0.88)" }}>
      {renderInline(text, key)}
    </p>
  );
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const elements = [];
  let index = 0;
  let keyIndex = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      elements.push(
        <hr
          key={`hr-${keyIndex}`}
          style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "28px 0" }}
        />
      );
      keyIndex += 1;
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = `h${level}`;
      const fontSizeMap = { 1: 34, 2: 26, 3: 20, 4: 18, 5: 16, 6: 14 };
      elements.push(
        <Tag
          key={`heading-${keyIndex}`}
          style={{
            margin: level === 1 ? "0 0 20px" : "28px 0 14px",
            fontSize: fontSizeMap[level] || 14,
            lineHeight: 1.3,
            color: "#f8fafc"
          }}
        >
          {renderInline(text, `heading-${keyIndex}`)}
        </Tag>
      );
      keyIndex += 1;
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      elements.push(
        <ol
          key={`ol-${keyIndex}`}
          style={{
            margin: "0 0 18px 22px",
            padding: 0,
            color: "rgba(255,255,255,0.88)",
            lineHeight: 1.85
          }}
        >
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${keyIndex}-${itemIndex}`} style={{ marginBottom: 8 }}>
              {renderInline(item, `ol-item-${keyIndex}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
      keyIndex += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      elements.push(
        <ul
          key={`ul-${keyIndex}`}
          style={{
            margin: "0 0 18px 22px",
            padding: 0,
            color: "rgba(255,255,255,0.88)",
            lineHeight: 1.85
          }}
        >
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${keyIndex}-${itemIndex}`} style={{ marginBottom: 8 }}>
              {renderInline(item, `ul-item-${keyIndex}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
      keyIndex += 1;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current) break;
      if (/^-{3,}$/.test(current)) break;
      if (/^(#{1,6})\s+/.test(current)) break;
      if (/^\d+\.\s+/.test(current)) break;
      if (/^[-*]\s+/.test(current)) break;
      paragraphLines.push(current);
      index += 1;
    }

    const paragraph = toParagraph(paragraphLines, `p-${keyIndex}`);
    if (paragraph) {
      elements.push(paragraph);
      keyIndex += 1;
    }
  }

  return elements;
}

export default function LegalPage() {
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    window.scrollTo(0, 0);

    const loadMarkdown = async () => {
      try {
        const res = await fetch("/legal/terms_zh.md", { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!canceled) {
          setMarkdown(text);
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!canceled) {
          setError(err.message || "加载法律条款失败");
        }
      }
    };

    loadMarkdown();
    return () => {
      canceled = true;
      controller.abort();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #08111f 0%, #10233d 42%, #0f1f33 100%)",
        color: "#fff",
        padding: "32px 20px 56px"
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <a
          href="/multiplayer?entry=1"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "#93c5fd",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 20
          }}
        >
          返回登录页
        </a>

        <div
          style={{
            padding: "28px 24px",
            borderRadius: 20,
            background: "rgba(15,23,42,0.76)",
            border: "1px solid rgba(148,163,184,0.18)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.28)"
          }}
        >
          {error ? (
            <div style={{ color: "#fca5a5", fontSize: 14 }}>法律条款加载失败：{error}</div>
          ) : markdown ? (
            renderMarkdown(markdown)
          ) : (
            <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 14 }}>正在加载法律条款...</div>
          )}
        </div>
      </div>
    </div>
  );
}

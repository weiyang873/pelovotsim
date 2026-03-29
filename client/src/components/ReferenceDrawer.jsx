import { useEffect, useRef, useState } from "react";
import "./reference-drawer.css";

const DOC_TABS = [
  { key: "briefing", label: "任务说明书", path: "/docs/task_briefing.html" },
  { key: "guide", label: "案例手册", path: "/docs/student_guide.html" }
];

function extractToc(html) {
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const headings = doc.querySelectorAll("h1, h2, h3");
  return Array.from(headings)
    .map((heading) => ({
      id: heading.id || "",
      text: String(heading.textContent || "").trim(),
      level: Number(heading.tagName.slice(1))
    }))
    .filter((heading) => heading.id && heading.text);
}

export default function ReferenceDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("briefing");
  const [docs, setDocs] = useState({ briefing: "", guide: "" });
  const [loadError, setLoadError] = useState("");
  const [activeHeadingId, setActiveHeadingId] = useState("");
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    let canceled = false;
    Promise.all(
      DOC_TABS.map(async (tab) => {
        const response = await fetch(tab.path);
        if (!response.ok) {
          throw new Error(`加载失败: ${tab.label}`);
        }
        return [tab.key, await response.text()];
      })
    )
      .then((entries) => {
        if (canceled) return;
        setDocs(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (canceled) return;
        setLoadError(error.message || "参考资料加载失败");
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setMobileTocOpen(false);
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const currentHtml = docs[activeTab];
  const tocItems = extractToc(currentHtml);

  useEffect(() => {
    if (!isOpen || !contentRef.current || !currentHtml) return undefined;
    const root = contentRef.current;
    const headings = Array.from(root.querySelectorAll("h1, h2, h3")).filter((heading) => heading.id);
    if (!headings.length) {
      setActiveHeadingId("");
      return undefined;
    }

    setActiveHeadingId(headings[0].id);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            if (a.boundingClientRect.top !== b.boundingClientRect.top) {
              return a.boundingClientRect.top - b.boundingClientRect.top;
            }
            return Number(a.target.dataset.headingIndex || 0) - Number(b.target.dataset.headingIndex || 0);
          });
        if (visible.length > 0) {
          setActiveHeadingId(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: "0px 0px -65% 0px",
        threshold: [0, 0.2, 0.5, 1]
      }
    );

    headings.forEach((heading, index) => {
      heading.dataset.headingIndex = String(index);
      observer.observe(heading);
    });

    return () => {
      observer.disconnect();
    };
  }, [activeTab, currentHtml, isOpen]);

  useEffect(() => {
    if (!isOpen || !contentRef.current) return;
    contentRef.current.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab, isOpen]);

  const handleHeadingClick = (id) => {
    if (!contentRef.current) return;
    const headings = Array.from(contentRef.current.querySelectorAll("h1, h2, h3"));
    const target = headings.find((heading) => heading.id === id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveHeadingId(id);
    setMobileTocOpen(false);
  };

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          className="reference-drawer__handle"
          onClick={() => setIsOpen(true)}
          aria-label="打开参考资料"
        >
          <span>参考资料</span>
        </button>
      ) : null}

      <div
        className={`reference-drawer__overlay${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen(false)}
        aria-hidden={isOpen ? "false" : "true"}
      />

      <aside
        className={`reference-drawer${isOpen ? " is-open" : ""}`}
        aria-hidden={isOpen ? "false" : "true"}
        aria-label="参考资料面板"
      >
        <div className="reference-drawer__header">
          <div className="reference-drawer__tabs" role="tablist" aria-label="参考资料切换">
            {DOC_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`reference-drawer__tab${activeTab === tab.key ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="reference-drawer__header-actions">
            <button
              type="button"
              className="reference-drawer__toc-toggle"
              onClick={() => setMobileTocOpen((open) => !open)}
            >
              目录
            </button>
            <button
              type="button"
              className="reference-drawer__close"
              onClick={() => setIsOpen(false)}
              aria-label="关闭参考资料"
            >
              ×
            </button>
          </div>
        </div>

        <div className="reference-drawer__body">
          <nav className={`reference-drawer__toc${mobileTocOpen ? " is-open" : ""}`} aria-label="文档目录">
            {tocItems.length ? (
              tocItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`reference-drawer__toc-item level-${item.level}${activeHeadingId === item.id ? " is-active" : ""}`}
                  onClick={() => handleHeadingClick(item.id)}
                >
                  {item.text}
                </button>
              ))
            ) : (
              <div className="reference-drawer__toc-empty">目录加载中...</div>
            )}
          </nav>

          <div className="reference-drawer__content-wrap">
            {loadError ? (
              <div className="reference-drawer__empty">{loadError}</div>
            ) : currentHtml ? (
              <div
                ref={contentRef}
                className="reference-drawer__content"
                dangerouslySetInnerHTML={{ __html: currentHtml }}
              />
            ) : (
              <div className="reference-drawer__empty">参考资料加载中...</div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

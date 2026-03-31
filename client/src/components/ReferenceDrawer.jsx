import { useEffect, useMemo, useRef, useState } from "react";
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

function normalizeHtml(html) {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return String(doc.body?.innerHTML || html).trim();
}

function createDocState() {
  return DOC_TABS.reduce((accumulator, tab) => {
    accumulator[tab.key] = { html: "", error: "", loaded: false };
    return accumulator;
  }, {});
}

export default function ReferenceDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("briefing");
  const [docs, setDocs] = useState(createDocState);
  const [activeHeadingId, setActiveHeadingId] = useState("");
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const contentRef = useRef(null);
  const tocRef = useRef(null);

  useEffect(() => {
    let canceled = false;

    DOC_TABS.forEach(async (tab) => {
      try {
        const response = await fetch(tab.path);
        if (!response.ok) {
          throw new Error(`加载失败: ${tab.label}`);
        }
        const html = normalizeHtml(await response.text());
        if (canceled) return;
        setDocs((prev) => ({
          ...prev,
          [tab.key]: { html, error: "", loaded: true }
        }));
      } catch (error) {
        if (canceled) return;
        setDocs((prev) => ({
          ...prev,
          [tab.key]: {
            html: "",
            error: error.message || "参考资料加载失败",
            loaded: true
          }
        }));
      }
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

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    setMobileTocOpen(false);
  }, [activeTab]);

  const currentDoc = docs[activeTab] || { html: "", error: "", loaded: false };
  const currentHtml = currentDoc.html;
  const currentError = currentDoc.error;
  const tocItems = useMemo(() => extractToc(currentHtml), [currentHtml]);

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
    setActiveHeadingId("");
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

  useEffect(() => {
    if (!isOpen || !tocRef.current || !activeHeadingId) return;
    const activeItem = Array.from(tocRef.current.querySelectorAll("[data-heading-id]")).find(
      (item) => item.getAttribute("data-heading-id") === activeHeadingId
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingId, isOpen]);

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
        aria-hidden={!isOpen}
        aria-label="参考资料面板"
        aria-modal={isOpen ? "true" : undefined}
        role="dialog"
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
          <nav
            ref={tocRef}
            className={`reference-drawer__toc${mobileTocOpen ? " is-open" : ""}`}
            aria-label="文档目录"
          >
            {tocItems.length ? (
              tocItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-heading-id={item.id}
                  className={`reference-drawer__toc-item level-${item.level}${activeHeadingId === item.id ? " is-active" : ""}`}
                  onClick={() => handleHeadingClick(item.id)}
                >
                  {item.text}
                </button>
              ))
            ) : (
              <div className="reference-drawer__toc-empty">
                {currentError ? "当前文档暂时不可用" : "目录加载中..."}
              </div>
            )}
          </nav>

          <div className="reference-drawer__content-wrap">
            {currentError ? (
              <div className="reference-drawer__empty">{currentError}</div>
            ) : currentHtml ? (
              <div
                ref={contentRef}
                className="reference-drawer__content"
                dangerouslySetInnerHTML={{ __html: currentHtml }}
              />
            ) : (
              <div className="reference-drawer__empty">
                {currentDoc.loaded ? "当前文档暂无内容" : "参考资料加载中..."}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

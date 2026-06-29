import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        h1: ({ children }) => (
          <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>
        ),
        h2: ({ children }) => (
          <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>
        ),
        h3: ({ children }) => (
          <p className="mb-1 mt-2 font-medium first:mt-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-inherit underline underline-offset-2 hover:opacity-70"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-[var(--silver-400)] pl-3 italic opacity-70 last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-2 border-[var(--silver-200)]" />,
        code: ({ className, children }) => {
          const isBlock = /language-/.test(className ?? "");
          if (isBlock) {
            return (
              <pre className="mb-2 overflow-x-auto rounded-md bg-[var(--space-overlay)] p-3 last:mb-0">
                <code className="font-mono text-[0.78rem] leading-relaxed">
                  {children}
                </code>
              </pre>
            );
          }
          return (
            <code className="rounded bg-[var(--space-overlay)] px-1 py-px font-mono text-[0.82em]">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

import { create } from "zustand";

export type ChatRole = "user" | "ai";

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
}

export type Tab = "preview" | "code";
export type PreviewDevice = "mobile" | "tablet" | "desktop";

const INITIAL_MESSAGES: Message[] = [
  {
    id: "m1",
    role: "user",
    content:
      "Build me a landing page for a SaaS product — a hero section, a features grid, and a pricing table.",
    timestamp: Date.now() - 1000 * 60 * 12,
  },
  {
    id: "m2",
    role: "ai",
    content:
      "Done! I scaffolded a Vite + React + TypeScript app and built a responsive landing page. It has a Hero with a headline and CTA, a three-column Features grid, and a Pricing section. Everything uses Tailwind and is mobile-friendly. Take a look at the preview.",
    timestamp: Date.now() - 1000 * 60 * 11,
  },
  {
    id: "m3",
    role: "user",
    content:
      "Nice. Make the hero background a subtle gradient and give the CTA button a hover state.",
    timestamp: Date.now() - 1000 * 60 * 7,
  },
  {
    id: "m4",
    role: "ai",
    content:
      "Updated the Hero component — the background now uses a soft top-to-bottom gradient, and the primary button scales slightly and brightens on hover. I also bumped the heading contrast a touch for readability.",
    timestamp: Date.now() - 1000 * 60 * 6,
  },
  {
    id: "m5",
    role: "user",
    content:
      "Add a pricing section with three tiers: Starter, Pro, Enterprise.",
    timestamp: Date.now() - 1000 * 60 * 2,
  },
  {
    id: "m6",
    role: "ai",
    content:
      "Added a Pricing component with three tiers. Pro is highlighted as the recommended plan with a badge, and each card lists its features with a checkmark. The grid collapses to a single column on smaller screens.",
    timestamp: Date.now() - 1000 * 60,
  },
];

const AI_REPLIES = [
  "Got it — I've applied that change and refreshed the preview. Let me know if you'd like any tweaks.",
  "Done. I updated the relevant components and kept everything consistent with the existing styles.",
  "Sure thing! I implemented that and verified it renders correctly across the device sizes.",
  "Updated. I also did a quick pass to make sure the layout stays responsive.",
];

let replyCursor = 0;

interface ProjectState {
  chatMessages: Message[];
  isAiTyping: boolean;
  isChatOpen: boolean;
  activeTab: Tab;
  openFiles: string[];
  activeFileId: string;
  previewDevice: PreviewDevice;
  splitPosition: number;
  codeTreeWidth: number;

  sendMessage: (content: string) => void;
  toggleChat: () => void;
  setActiveTab: (tab: Tab) => void;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  closeFilesToRight: (id: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (id: string) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setSplitPosition: (px: number) => void;
  setCodeTreeWidth: (px: number) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  chatMessages: INITIAL_MESSAGES,
  isAiTyping: false,
  isChatOpen: true,
  activeTab: "preview",
  openFiles: ["app"],
  activeFileId: "app",
  previewDevice: "desktop",
  splitPosition: 400,
  codeTreeWidth: 240,

  sendMessage: (content) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    set((s) => ({
      chatMessages: [...s.chatMessages, userMessage],
      isAiTyping: true,
    }));

    // Fake the assistant "thinking", then resolve to a canned reply.
    setTimeout(() => {
      const reply = AI_REPLIES[replyCursor % AI_REPLIES.length];
      replyCursor += 1;
      set((s) => ({
        isAiTyping: false,
        chatMessages: [
          ...s.chatMessages,
          {
            id: crypto.randomUUID(),
            role: "ai",
            content: reply,
            timestamp: Date.now(),
          },
        ],
      }));
    }, 1200);
  },

  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),

  // Open a file's tab (or focus it if already open) and make it active.
  openFile: (id) =>
    set((s) => ({
      openFiles: s.openFiles.includes(id) ? s.openFiles : [...s.openFiles, id],
      activeFileId: id,
    })),

  // Close a tab; if it was active, fall back to the nearest remaining tab.
  closeFile: (id) =>
    set((s) => {
      const idx = s.openFiles.indexOf(id);
      const openFiles = s.openFiles.filter((f) => f !== id);
      const activeFileId =
        s.activeFileId === id
          ? (openFiles[idx] ?? openFiles[idx - 1] ?? "")
          : s.activeFileId;
      return { openFiles, activeFileId };
    }),

  // Close every tab after the given one; keep the active tab valid.
  closeFilesToRight: (id) =>
    set((s) => {
      const idx = s.openFiles.indexOf(id);
      if (idx === -1) return {};
      const openFiles = s.openFiles.slice(0, idx + 1);
      const activeFileId = openFiles.includes(s.activeFileId)
        ? s.activeFileId
        : id;
      return { openFiles, activeFileId };
    }),

  closeAllFiles: () => set({ openFiles: [], activeFileId: "" }),

  setActiveFile: (activeFileId) => set({ activeFileId }),
  setPreviewDevice: (previewDevice) => set({ previewDevice }),
  setSplitPosition: (splitPosition) => set({ splitPosition }),
  setCodeTreeWidth: (codeTreeWidth) => set({ codeTreeWidth }),
}));

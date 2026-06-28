import { motion } from "motion/react";

import BorderGlow from "@/src/components/ui/glow-loader";
import { useProjectStore } from "@/src/stores/useProjectStore";

const DEVICE_WIDTH: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 9999,
};

function PreviewPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center p-0">
      <BorderGlow
        autoAnimate
        autoAnimateDuration={3200}
        coneSpread={8}
        borderRadius={20}
        backgroundColor="var(--space-surface)"
        glowColor="253 91 85"
        colors={["#8b7bff", "#f472b6", "#38bdf8"]}
        glowRadius={32}
        glowIntensity={0.9}
        fillOpacity={0.3}
        className=" px-8 mx-0 py-5"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="logo-mark size-12" role="img" aria-label="tau" />

          <div className="flex flex-col items-center  text-center">
            <span className="text-sm font-semibold text-(--silver-900)">
              tau is building your app…
            </span>
          </div>
        </div>
      </BorderGlow>
    </div>
  );
}

export function PreviewPane({ device }: { device: string }) {
  const previewUrl = useProjectStore((s) => s.previewUrl);
  const previewNonce = useProjectStore((s) => s.previewNonce);

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <motion.div
        animate={{ maxWidth: DEVICE_WIDTH[device] }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="relative h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--silver-200)]"
        style={{ backgroundColor: "var(--space-void)" }}
      >
        {previewUrl ? (
          <iframe
            key={`${previewUrl}-${previewNonce}`}
            src={previewUrl}
            title="App preview"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <PreviewPlaceholder />
        )}
      </motion.div>
    </div>
  );
}

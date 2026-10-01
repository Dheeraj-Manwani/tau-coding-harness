import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, PaperclipIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { api } from "@/src/lib/api-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { useRedeemCode } from "@/src/features/billing/api";
import { useAttachments } from "@/src/features/composer/attachments/useAttachments";
import { AttachmentRail } from "@/src/features/composer/attachments/AttachmentRail";
import { useFeedbackStore } from "./useFeedbackStore";
import { FeedbackStars } from "./FeedbackStars";

type Reward = {
  id: string;
  promoCode: string;
  credits: number;
  alreadyRedeemed: boolean;
};

function FeedbackForm() {
  const source = useFeedbackStore((s) => s.source);
  const projectId = useFeedbackStore((s) => s.projectId);
  const [rating, setRating] = useState(0);
  const [kind, setKind] = useState<"feedback" | "suggestion">("feedback");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const attachments = useAttachments();
  const redeem = useRedeemCode();
  const submit = useMutation({
    mutationFn: () => {
      useFeedbackStore.setState({ submitting: true });
      return api
        .post<Reward>("/feedback", {
          rating,
          kind,
          message,
          source,
          projectId,
          attachmentIds: attachments.readyIds,
        })
        .then((r) => r.data);
    },
    onSuccess: () => attachments.clear(),
    onSettled: () => useFeedbackStore.setState({ submitting: false }),
  });
  const busy = submit.isPending || attachments.isBusy;

  if (submit.data) {
    const rewarded = submit.data.alreadyRedeemed || redeem.isSuccess;
    return (
      <div className="grid gap-4 py-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <CheckCircle2Icon className="size-8 text-zinc-200" />
          <div className="space-y-1.5">
            <DialogTitle>Feedback received</DialogTitle>
            <DialogDescription>
              Thanks for helping us improve tau.
            </DialogDescription>
          </div>
        </div>
        {rewarded ? (
          <p role="status" className="mx-auto w-full max-w-sm text-sm leading-relaxed text-muted-foreground">
            {redeem.isSuccess
              ? "100 credits have been added to your account."
              : "Your account has already redeemed the 100-credit feedback reward. We appreciate every suggestion."}
          </p>
        ) : (
          <>
            <p className="mx-auto w-full max-w-sm text-sm leading-relaxed text-muted-foreground">
              You unlocked 100 extra credits. Redeem your code here or on the
              Credits page. One reward per account.
            </p>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <code className="text-lg font-semibold tracking-wider">
                {submit.data.promoCode}
              </code>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(submit.data!.promoCode)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy code"}
              </Button>
            </div>
            <Button
              className="w-full"
              disabled={redeem.isPending}
              onClick={() => redeem.mutate(submit.data!.promoCode)}
            >
              {redeem.isPending ? "Redeeming…" : "Redeem 100 credits"}
            </Button>
            {redeem.error && (
              <p role="alert" className="text-sm text-red-400">
                {redeem.error.message}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="pr-7 space-y-1.5">
        <DialogTitle>Help shape tau</DialogTitle>
        <DialogDescription>
          Share your experience or an idea for what’s next.
        </DialogDescription>
      </div>
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (rating && !busy) submit.mutate();
      }}
    >
      <div>
        <label htmlFor="feedback-kind" className="sr-only">
          What would you like to share?
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="feedback-kind"
              type="button"
              variant="outline"
              disabled={submit.isPending}
              className="h-10 w-full justify-start font-normal"
            >
              {kind === "feedback" ? "Feedback" : "Suggestion"}
              <ChevronDownIcon className="ml-auto size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="dialog-theme w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            <DropdownMenuRadioGroup
              value={kind}
              onValueChange={(value) => setKind(value as typeof kind)}
            >
              <DropdownMenuRadioItem value="feedback">
                Feedback
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="suggestion">
                Suggestion
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FeedbackStars
        value={rating}
        onChange={setRating}
        disabled={submit.isPending}
      />
      <div>
        <label
          htmlFor="feedback-message"
          className="mb-2 block text-sm font-medium"
        >
          Message <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="feedback-message"
          value={message}
          maxLength={5000}
          disabled={submit.isPending}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              attachments.addFiles(pasted);
            }
          }}
          placeholder={
            kind === "suggestion"
              ? "What would you like tau to do next?"
              : "What worked well? What could we improve?"
          }
          rows={4}
          className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {message.length.toLocaleString()} / 5,000
        </p>
      </div>
      <div>
        <input
          ref={files}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attachments.addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-dashed"
          disabled={submit.isPending}
          onClick={() => files.current?.click()}
        >
          <PaperclipIcon className="size-4" /> Add screenshots or files{" "}
          <span className="text-muted-foreground">(optional)</span>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Up to 5 files. Images up to 5 MB; documents up to 10 MB. You can also
          paste a screenshot into the message.
        </p>
        <AttachmentRail
          attachments={attachments.attachments}
          onRemove={attachments.remove}
          className="mt-2"
        />
      </div>
      {submit.error && (
        <p role="alert" className="text-sm text-red-400">
          {submit.error.message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full" disabled={!rating || busy}>
        {submit.isPending
          ? "Sending…"
          : attachments.isBusy
            ? "Uploading files…"
            : kind === "suggestion"
              ? "Send suggestion"
              : "Send feedback"}
      </Button>
    </form>
    </>
  );
}

export function FeedbackModal() {
  const isOpen = useFeedbackStore((s) => s.isOpen);
  const close = useFeedbackStore((s) => s.close);
  const submitting = useFeedbackStore((s) => s.submitting);
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={!submitting}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto border border-zinc-800 p-6 sm:max-w-md [&>button[data-slot=dialog-close]]:top-4 [&>button[data-slot=dialog-close]]:right-4"
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (submitting) e.preventDefault();
        }}
      >
        {isOpen && <FeedbackForm />}
      </DialogContent>
    </Dialog>
  );
}

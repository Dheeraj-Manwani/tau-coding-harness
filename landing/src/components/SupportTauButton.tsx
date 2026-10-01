import BuyMeCoffee from "@/src/components/ui/buy-me-coffee";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";

export function SupportTauButton({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={className}>
          Support tau
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogTitle>Support tau</DialogTitle>
        <DialogDescription>
          Enjoying tau? Buy me a coffee to support its development.
        </DialogDescription>
        <BuyMeCoffee classname="my-0 h-64 w-full max-w-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:[&_*]:transition-none" />
      </DialogContent>
    </Dialog>
  );
}

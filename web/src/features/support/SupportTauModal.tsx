import BuyMeCoffee from "@/src/components/ui/buy-me-coffee";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/src/components/ui/dialog";
import { useSupportStore } from "./useSupportStore";

export function SupportTauModal() {
  const isOpen = useSupportStore((s) => s.isOpen);
  const setOpen = useSupportStore((s) => s.setOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
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

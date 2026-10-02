import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon, UserRoundIcon } from "lucide-react";

import { useMe } from "@/src/features/auth/queries";
import { ProfileCard } from "@/src/features/account/ProfileCard";
import { ActivityCard } from "@/src/features/account/ActivityGraph";
import { AccountDetailsCard } from "@/src/features/account/AccountDetailsCard";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { PageContainer } from "@/src/components/PageContainer";

export default function Account() {
  const navigate = useNavigate();
  const { data: user } = useMe();

  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back
      </button>

      <div className="mb-6 flex items-center gap-2">
        <UserRoundIcon />
        <h1 className="text-xl font-semibold">Account</h1>
      </div>

      {user ? (
        <div className="space-y-4">
          <ProfileCard user={user} />
          <ActivityCard />
          <AccountDetailsCard user={user} />
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center">
          <DataSpinner label="Loading your account" />
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        tau only keeps a name and a picture, both optional. Your activity is
        yours alone: nobody else can see this page.
      </p>
    </PageContainer>
  );
}

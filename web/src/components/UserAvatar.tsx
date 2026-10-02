import { Avatar, AvatarFallback, AvatarImage } from "@/src/components/ui/avatar";
import {
  avatarSrc,
  initialsOf,
  type Identity,
} from "@/src/features/account/identity";
import { cn } from "@/src/lib/utils";

/**
 * The one avatar used everywhere: the profile picture when there is one,
 * otherwise the classic: white initials on black, with a hairline ring so it
 * doesn't vanish into the near-black page.
 */
export function UserAvatar({
  user,
  className,
  fallbackClassName,
}: {
  user: Identity;
  className?: string;
  fallbackClassName?: string;
}) {
  const src = avatarSrc(user);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback
        className={cn(
          "bg-black font-semibold text-white ring-1 ring-silver-400/40 ring-inset",
          fallbackClassName,
        )}
      >
        {initialsOf(user)}
      </AvatarFallback>
    </Avatar>
  );
}

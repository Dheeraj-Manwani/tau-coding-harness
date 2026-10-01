import PeekRating from "@/src/components/ui/PeekRating";

export function FeedbackStars({ value, onChange, disabled }: {
  value: number;
  onChange: (rating: number) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="border-0 p-0">
      <legend className="sr-only">Your rating (required)</legend>
      <div className="flex justify-center py-1">
        <PeekRating
          value={value}
          onChange={onChange}
          count={5}
          shape="star"
          labels={["Poor", "Fair", "Good", "Great", "Superb"]}
          activeColor="#f5b400"
          idleColor="#52525b"
          tipColor="#27272a"
          tipTextColor="#f5f5f5"
          size={40}
          lift={8}
          magnify={1.15}
          riseDuration={320}
          popScale={1.3}
          showTip
          reserveTipSpace={false}
          allowClear
          required
          disabled={disabled}
          ariaLabel="Your rating"
        />
      </div>
    </fieldset>
  );
}

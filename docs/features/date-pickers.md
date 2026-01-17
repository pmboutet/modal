# Date Pickers

Complete suite of modern, accessible, and consistent date selection components.

## Overview

The application includes a complete suite of date picker components built on **React Aria Components** (Adobe), ensuring first-class accessibility.

**Components:**
| Component | File | Usage |
|-----------|------|-------|
| Calendar | `src/components/ui/calendar.tsx` | Base calendar component |
| DatePicker | `src/components/ui/date-picker.tsx` | Simple date selection |
| DateTimePicker | `src/components/ui/date-time-picker.tsx` | Date + time selection |
| DateRangePicker | `src/components/ui/date-range-picker.tsx` | Date range selection |
| Index | `src/components/ui/date-pickers.ts` | Centralized exports |

**Test page:** http://localhost:3000/test-date-pickers

## Quick Start

```tsx
import { DatePicker, DateTimePicker, DateRangePicker } from '@/components/ui/date-pickers';

// Date only
<DatePicker value={date} onChange={setDate} />

// Date + time
<DateTimePicker value={datetime} onChange={setDatetime} />

// Date range
<DateRangePicker value={range} onChange={setRange} />
```

---

## API Reference

### DatePicker

For selecting only a date (no time).

```tsx
import { DatePicker } from '@/components/ui/date-pickers';

function MyComponent() {
  const [date, setDate] = useState<string>("");

  return (
    <DatePicker
      value={date}
      onChange={setDate}
      placeholder="Select a date"
      minDate={new Date()}
      maxDate={new Date(2025, 11, 31)}
    />
  );
}
```

**Props:**
- `value`: `string` - ISO format date
- `onChange`: `(value: string) => void` - Change callback
- `placeholder`: `string` - Placeholder text
- `disabled`: `boolean` - Disable the picker
- `minDate`: `Date` - Minimum selectable date
- `maxDate`: `Date` - Maximum selectable date
- `className`: `string` - Additional CSS classes
- `align`: `"start" | "center" | "end"` - Popover alignment

### DateTimePicker

For selecting date AND time.

```tsx
import { DateTimePicker } from '@/components/ui/date-pickers';

function MyComponent() {
  const [datetime, setDatetime] = useState<string>("");

  return (
    <DateTimePicker
      value={datetime}
      onChange={setDatetime}
      placeholder="Select date and time"
    />
  );
}
```

**Props:** Same as DatePicker. Time selection is integrated in the popover.

### DateRangePicker

For selecting a date range (start and end).

```tsx
import { DateRangePicker, type DateRange } from '@/components/ui/date-pickers';

function MyComponent() {
  const [range, setRange] = useState<DateRange | null>(null);

  return (
    <DateRangePicker
      value={range}
      onChange={setRange}
      placeholder="Select a period"
    />
  );
}
```

**DateRange type:**
```tsx
interface DateRange {
  start: string; // ISO date string
  end: string;   // ISO date string
}
```

### Calendar

Standalone calendar component.

```tsx
import { Calendar } from '@/components/ui/date-pickers';

function MyComponent() {
  const [date, setDate] = useState<Date | null>(null);

  return (
    <Calendar
      selected={date}
      onSelect={setDate}
      minDate={new Date()}
    />
  );
}
```

---

## Usage with React Hook Form

All components are compatible with React Hook Form via `Controller`.

```tsx
import { Controller, useForm } from "react-hook-form";
import { DateTimePicker } from "@/components/ui/date-pickers";

function MyForm() {
  const form = useForm({
    defaultValues: {
      startDate: "",
      endDate: ""
    }
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Controller
        control={form.control}
        name="startDate"
        render={({ field }) => (
          <DateTimePicker
            value={field.value}
            onChange={field.onChange}
            placeholder="Start date"
          />
        )}
      />
    </form>
  );
}
```

---

## Examples

### Conditional Dates

```tsx
function ConditionalDates() {
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const minEndDate = startDate ? new Date(startDate) : undefined;

  return (
    <div>
      <DatePicker
        value={startDate}
        onChange={setStartDate}
        placeholder="Start date"
      />

      <DatePicker
        value={endDate}
        onChange={setEndDate}
        placeholder="End date"
        minDate={minEndDate}
        disabled={!startDate}
      />
    </div>
  );
}
```

### With Custom Validation

```tsx
function ValidatedDatePicker() {
  const [date, setDate] = useState<string>("");
  const [error, setError] = useState<string>("");

  const handleDateChange = (value: string) => {
    setDate(value);

    if (!value) {
      setError("Date is required");
      return;
    }

    const selectedDate = new Date(value);
    const minTime = Date.now() + (24 * 60 * 60 * 1000);

    if (selectedDate.getTime() < minTime) {
      setError("Date must be at least 24h in the future");
    } else {
      setError("");
    }
  };

  return (
    <div>
      <DateTimePicker
        value={date}
        onChange={handleDateChange}
        className={error ? "border-red-500" : ""}
      />
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
}
```

### Booking Form

```tsx
function BookingForm() {
  const [checkIn, setCheckIn] = useState<string>("");
  const [checkOut, setCheckOut] = useState<string>("");

  const today = new Date();
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 6);

  return (
    <form>
      <DateTimePicker
        value={checkIn}
        onChange={setCheckIn}
        placeholder="Check-in date"
        minDate={today}
        maxDate={maxDate}
      />

      <DateTimePicker
        value={checkOut}
        onChange={setCheckOut}
        placeholder="Check-out date"
        minDate={checkIn ? new Date(checkIn) : today}
        disabled={!checkIn}
      />
    </form>
  );
}
```

---

## Features

### Accessibility (A11y)
- Full keyboard navigation
- Screen reader support
- Focus management
- Appropriate ARIA labels
- Built on React Aria Components (Adobe)

### Design
- Smooth animations (scale, fade, slide)
- Visual effects (gradients, shadows, rings)
- Optimized dark mode
- Responsive and mobile-friendly

### Functionality
- Min/max date constraints
- Disable specific dates
- Clear/reset button
- Localized date format
- Timezone handling
- React Hook Form compatible

---

## Migration from Native Input

**Before:**
```tsx
<input type="date" value={date} onChange={e => setDate(e.target.value)} />
```

**After:**
```tsx
<DatePicker value={date} onChange={setDate} />
```

**Benefits:**
1. Consistent design across all browsers
2. Better accessibility
3. More customization options
4. Advanced constraint support
5. Animations and visual feedback

---

## Tech Stack

```json
{
  "react-aria-components": "^1.13.0",
  "@internationalized/date": "^3.10.0",
  "date-fns": "^4.1.0",
  "@radix-ui/react-popover": "^1.1.15",
  "lucide-react": "^0.344.0"
}
```

---

## Troubleshooting

**Calendar doesn't display:**
- Check Tailwind is properly configured
- Verify classes are in tailwind.config.js content

**Dates are offset by one day:**
- Components handle timezones automatically
- Use the ISO string values provided

**Popover is cut off:**
- Use the `sideOffset` prop
- Ensure parent has `overflow: visible`

---

## Currently Used In

- `ProjectManager.tsx` - Project dates
- `ChallengeEditor.tsx` - Due dates
- `AskCreateForm.tsx` - Session dates
- `AskEditForm.tsx` - Session dates
- `AdminDashboard.tsx` - Various forms
- `ProjectJourneyBoard.tsx` - Timeline

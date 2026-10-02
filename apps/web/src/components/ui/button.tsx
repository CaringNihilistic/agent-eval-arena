import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Buttons read only design tokens: sage for the primary action, a rose (or, on
// parchment, ink) outline for the rest. Labels are set in the label face.
const buttonVariants = cva(
  "deco-label inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border text-center transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:border-primary",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:bg-sage-hover hover:border-sage-hover",
        outline: "border-ornament bg-transparent text-foreground hover:bg-accent",
        ghost: "border-transparent bg-transparent text-foreground underline underline-offset-4 hover:bg-accent",
        accuse: "border-destructive bg-transparent text-destructive hover:bg-accent",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-8 px-3 py-1",
        lg: "min-h-12 px-6 py-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

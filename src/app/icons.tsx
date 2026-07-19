import type { SVGProps } from "react";

function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function GripIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="1" />
      <circle cx="16" cy="8" r="1" />
      <circle cx="8" cy="16" r="1" />
      <circle cx="16" cy="16" r="1" />
    </Icon>
  );
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7.3 7.3 0 0 0-2.1-1.2L14.3 3h-4l-.4 2.6a7.3 7.3 0 0 0-2.1 1.2l-2.3-1-2 3.5 2 1.5a7.2 7.2 0 0 0 0 2.4l-2 1.5 2 3.5 2.3-1c.6.5 1.4.9 2.1 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2.1-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </Icon>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

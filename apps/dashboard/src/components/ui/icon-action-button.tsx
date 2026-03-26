import type { ReactNode } from 'react';

import { Button, type ButtonProps } from './button.js';

export interface IconActionButtonProps
  extends Omit<ButtonProps, 'children' | 'size' | 'variant'> {
  label: string;
  children: ReactNode;
}

export function IconActionButton(props: IconActionButtonProps): JSX.Element {
  const { label, title, type = 'button', children, ...buttonProps } = props;
  return (
    <Button
      type={type}
      size="icon"
      variant="outline"
      aria-label={label}
      title={title ?? label}
      {...buttonProps}
    >
      {children}
    </Button>
  );
}

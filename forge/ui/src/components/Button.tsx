import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'default' | 'compact' | 'large';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'default',
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  ...props
}) => {
  const sizeClasses = {
    default: 'btn',
    compact: 'btn btn--compact',
    large: 'btn btn--large',
  };

  const variantClasses = {
    primary: 'btn--primary',
    secondary: 'btn--secondary',
    danger: 'btn--danger',
    ghost: 'btn--ghost',
  };

  return (
    <button
      className={`${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="loading-cursor" style={{ width: 6, height: 12 }} />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
};

export default Button;

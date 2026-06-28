import styled from "styled-components";
import { useState } from "react";

export const Container = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: 24px;
`;

export const Card = styled.div`
  width: 100%;
  max-width: 420px;
  background: var(--color-surface-hover);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
`;

export const Logo = styled.div`
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--color-text-muted);
  margin-bottom: 16px;
`;

export const Title = styled.h1`
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-muted);
  margin-bottom: 6px;
`;

export const Subtitle = styled.p`
  text-align: center;
  font-size: 13px;
  color: var(--color-text);
  margin-bottom: 22px;
  line-height: 1.4;
`;

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const Input = styled.input`
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--color-bg);
  color: var(--color-text-muted);
  outline: none;
  transition: 0.2s ease;

  &::placeholder {
    color: var(--color-text);
  }

  &:focus {
    border-color: var(--color-accent);
  }
`;

export const PrimaryButton = styled.button`
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  border: none;
  background: var(--color-accent);
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: 0.15s ease;

  &:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const TextButton = styled.button`
  margin-top: 14px;
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: var(--color-text-muted);
  }
`;

export const Footer = styled.div`
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text);
`;

export const Accent = styled.span`
  margin-left: 6px;
  color: var(--color-accent);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    text-decoration: underline;
  }
`;

function LoginView({ setView }) {
  return (
    <>
      <Subtitle>Sign in to continue.</Subtitle>

      <Form>
        <Input type="email" placeholder="Email" required />
        <Input type="password" placeholder="Password" required />

        <PrimaryButton type="submit">Login</PrimaryButton>
      </Form>

      <TextButton type="button" onClick={() => setView("forgot")}>
        Forgot Password?
      </TextButton>

      <Footer>
        Don't have an account?
        <Accent onClick={() => setView("signup")}>Sign Up</Accent>
      </Footer>
    </>
  );
}

function SignupView({ setView }) {
  return (
    <>
      <Subtitle>Create an account to get started.</Subtitle>

      <Form>
        <Input placeholder="Username" required />
        <Input type="email" placeholder="Email" required />
        <Input type="password" placeholder="Password" required />
        <Input type="password" placeholder="Confirm Password" required />

        <PrimaryButton type="submit">Create Account</PrimaryButton>
      </Form>

      <Footer>
        Already have an account?
        <Accent onClick={() => setView("login")}>Login</Accent>
      </Footer>
    </>
  );
}

function ForgotView({ setView }) {
  return (
    <>
      <Subtitle>
        Enter your email and we'll send you a reset link.
      </Subtitle>

      <Form>
        <Input type="email" placeholder="Email" required />
        <PrimaryButton type="submit">Send Reset Link</PrimaryButton>
      </Form>

      <Footer>
        Remember your password?
        <Accent onClick={() => setView("login")}>Login</Accent>
      </Footer>
    </>
  );
}

function AuthPage() {
  const [view, setView] = useState("login");

  const renderView = () => {
    switch (view) {
      case "signup":
        return <SignupView setView={setView} />;
      case "forgot":
        return <ForgotView setView={setView} />;
      default:
        return <LoginView setView={setView} />;
    }
  };

  return (
    <Container>
      <Card>
        <Logo>WHATEVER</Logo>
        <Title>
          {view === "login"
            ? "Welcome Back"
            : view === "signup"
            ? "Create Account"
            : "Reset Password"}
        </Title>

        {renderView()}
      </Card>
    </Container>
  );
}

export default AuthPage;
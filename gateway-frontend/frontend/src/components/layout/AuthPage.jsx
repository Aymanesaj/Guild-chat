import styled from "styled-components";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TbEye, TbEyeOff } from "react-icons/tb";
import { loginUser, registerUser } from "../../api/authentication.js";
import {
  Button,
  Card as UICard,
  IconButton,
  Input as UIInput,
} from "../ui";

const Container = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(
      900px circle at 50% -10%,
      var(--accent-soft),
      transparent 60%
    ),
    var(--bg-base);
  padding: var(--space-5);
`;

const Card = styled(UICard)`
  width: 100%;
  max-width: 420px;
  padding: var(--space-6);
`;

const Logo = styled.div`
  text-align: center;
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--accent-500);
  margin-bottom: var(--space-4);
`;

const Title = styled.h1`
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  margin: 0 0 6px;
`;

const Subtitle = styled.p`
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0 0 22px;
  line-height: 1.5;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Input = UIInput;

const PasswordWrap = styled.div`
  position: relative;
  display: flex;

  input {
    padding-right: 44px;
  }

  button {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
  }
`;

const PrimaryButton = styled(Button)`
  margin-top: 6px;
`;

const Footer = styled.div`
  margin-top: 18px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
`;

const LegalNote = styled.p`
  margin: var(--space-4) 0 0;
  max-width: 420px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-tertiary);

  a {
    color: var(--text-secondary);
    text-decoration: underline;
  }
`;

/* Consent line under the sign-up button: small and plain so it informs
   without competing with the form. */
const SignupConsent = styled.p`
  margin: 0;
  text-align: center;
  font-size: var(--text-xs);
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-tertiary);

  a {
    color: var(--text-secondary);
    text-decoration: underline;
  }
`;

const ErrorText = styled.p`
  margin: -2px 0 0;
  min-height: 18px;
  font-size: var(--text-sm);
  color: var(--danger);
`;

const Accent = styled.span`
  margin-left: 6px;
  color: var(--accent-400);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    text-decoration: underline;
  }
`;

/** Password field with a show/hide toggle. */
function PasswordInput({ placeholder, value, onChange, ...rest }) {
  const [visible, setVisible] = useState(false);

  return (
    <PasswordWrap>
      <Input
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        required
        value={value}
        onChange={onChange}
        {...rest}
      />
      <IconButton
        type="button"
        $size={30}
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <TbEyeOff size={18} /> : <TbEye size={18} />}
      </IconButton>
    </PasswordWrap>
  );
}

function LoginView({ setView, onLogin, values, onChange, error, loading }) {
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    // A failed sign-in is reported through `error`; stay on the form.
    if (await onLogin(values.email, values.password)) {
      navigate("/app");
    }
  };

  return (
    <>
      <Subtitle>Sign in to continue.</Subtitle>

      <Form onSubmit={handleLogin}>
        <Input
          type="text"
          name="identifier"
          autoComplete="username"
          placeholder="Email or username"
          required
          value={values.email}
          onChange={(e) => onChange("email", e.target.value)}
        />
        <PasswordInput
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          value={values.password}
          onChange={(e) => onChange("password", e.target.value)}
        />

        <ErrorText>{error}</ErrorText>

        <PrimaryButton type="submit" $full disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </PrimaryButton>
      </Form>

      <Footer>
        Don't have an account?
        <Accent onClick={() => setView("signup")}>Sign Up</Accent>
      </Footer>
    </>
  );
}

function SignupView({ setView, onSignup, values, onChange, error, loading }) {
  const navigate = useNavigate();

  const handleSignup = async (e) => {
    e.preventDefault();
    // Covers both a rejected registration and a local password mismatch.
    if (await onSignup(values.username, values.email, values.password, values.confirmPassword)) {
      navigate("/app");
    }
  };

  return (
    <>
      <Subtitle>Create an account to get started.</Subtitle>

      <Form onSubmit={handleSignup}>
        <Input
          name="username"
          autoComplete="username"
          placeholder="Username"
          required
          value={values.username}
          onChange={(e) => onChange("username", e.target.value)}
        />
        <Input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={values.email}
          onChange={(e) => onChange("email", e.target.value)}
        />
        <PasswordInput
          name="password"
          autoComplete="new-password"
          placeholder="Password"
          value={values.password}
          onChange={(e) => onChange("password", e.target.value)}
        />
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Confirm Password"
          value={values.confirmPassword}
          onChange={(e) => onChange("confirmPassword", e.target.value)}
        />

        <ErrorText>{error}</ErrorText>

        <PrimaryButton type="submit" $full disabled={loading}>
          {loading ? "Creating..." : "Create Account"}
        </PrimaryButton>

        <SignupConsent>
          By creating an account, you agree to the{" "}
          <Link to="/terms">Terms of Service</Link> and acknowledge the{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </SignupConsent>
      </Form>

      <Footer>
        Already have an account?
        <Accent onClick={() => setView("login")}>Login</Accent>
      </Footer>
    </>
  );
}

function AuthPage( { onLogin } ) {
  const [view, setView] = useState("login");
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  /** Resolves to true when the session is established, so the view can navigate. */
  const handleLogin = async (email, password) => {
    setLoading(true);
    setError("");

    try {
      onLogin(await loginUser(email, password));
      return true;
    } catch (err) {
      if (err?.status >= 500) {
        setError("Something went wrong. Please try again later.");
      } else {
        setError(err.message);
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (username, email, password, confirmPassword) => {
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return false;
    }

    setLoading(true);
    setError("");

    try {
      onLogin(await registerUser(username, email, password));
      return true;
    } catch (err) {
      if (err?.status >= 500) {
        setError("Something went wrong. Please try again later.");
      } else {
        setError(err.message);
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const renderView = () => {
    switch (view) {
      case "signup":
        return (
          <SignupView
            setView={setView}
            onSignup={handleSignup}
            values={form}
            onChange={updateField}
            error={error}
            loading={loading}
          />
        );
      default:
        return (
          <LoginView
            setView={setView}
            onLogin={handleLogin}
            values={form}
            onChange={updateField}
            error={error}
            loading={loading}
          />
        );
    }
  };

  return (
    <Container>
      <Card>
        <Logo>FT_TRANSCENDENCE</Logo>
        <Title>
          {view === "login" ? "Welcome Back" : "Create Account"}
        </Title>

        {renderView()}
      </Card>

      {/* Sign-up carries its own consent line under the button. */}
      {view === "login" && (
        <LegalNote>
          By continuing you agree to our <Link to="/terms">Terms of Service</Link>{" "}
          and <Link to="/privacy">Privacy Policy</Link>.
        </LegalNote>
      )}
    </Container>
  );
}

export default AuthPage;

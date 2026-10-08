import styled from "styled-components";
import { Link } from "react-router-dom";
import { Button } from "../ui";
import { Page, Container } from "../landing/styles";
import LegalFooter from "./LegalFooter";

const Nav = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--border-subtle);
`;

const Brand = styled(Link)`
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--accent-500);
  text-decoration: none;
  white-space: nowrap;

  @media (max-width: 480px) {
    font-size: var(--text-xs);
    letter-spacing: 0.1em;
  }
`;

const Article = styled.article`
  max-width: 68ch;
  margin: 0 auto;
  padding: var(--space-6) 0 64px;
  color: var(--text-secondary);
  line-height: 1.7;

  strong {
    color: var(--text-primary);
  }

  a {
    color: var(--accent-400);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export const Title = styled.h1`
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0;

  @media (max-width: 700px) {
    font-size: 24px;
  }
`;

export const Updated = styled.p`
  margin: var(--space-2) 0 var(--space-6);
  font-size: var(--text-sm);
  color: var(--text-tertiary);
`;

export const Heading = styled.h2`
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
  margin: var(--space-6) 0 var(--space-2);
`;

export const Text = styled.p`
  margin: 0 0 var(--space-3);
`;

export const List = styled.ul`
  margin: 0 0 var(--space-3);
  padding-left: var(--space-5);

  li {
    margin-bottom: var(--space-2);
  }
`;

/** Shared frame for the Privacy Policy and Terms of Service pages. */
function LegalPage({ children }) {
  return (
    <Page>
      <Container>
        <Nav>
          <Brand to="/">FT_TRANSCENDENCE</Brand>
          <Button as={Link} to="/" $variant="secondary" $size="sm">
            Back
          </Button>
        </Nav>
      </Container>

      <Container>
        <Article>{children}</Article>
      </Container>

      <LegalFooter />
    </Page>
  );
}

export default LegalPage;

import styled from "styled-components";
import { Link } from "react-router-dom";
import { Container } from "../landing/styles";

const FooterRoot = styled.footer`
  margin-top: auto;
  padding: var(--space-5) 0;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  color: var(--text-tertiary);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;

  @media (max-width: 480px) {
    justify-content: center;
    text-align: center;
  }
`;

const Links = styled.nav`
  display: flex;
  gap: var(--space-4);

  a {
    color: var(--text-tertiary);
    text-decoration: none;

    &:hover {
      color: var(--text-primary);
      text-decoration: underline;
    }
  }
`;

/** Site footer carrying the Privacy Policy and Terms of Service links. */
function LegalFooter() {
  return (
    <FooterRoot>
      <Container>
        <Row>
          <span>CHATAPP — Built for ft_transcendence</span>
          <Links aria-label="Legal">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </Links>
        </Row>
      </Container>
    </FooterRoot>
  );
}

export default LegalFooter;

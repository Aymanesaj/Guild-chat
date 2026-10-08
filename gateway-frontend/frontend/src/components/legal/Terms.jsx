import LegalPage, { Title, Updated, Heading, Text, List } from "./LegalPage";

const LAST_UPDATED = "29 September 2026";

function Terms() {
  return (
    <LegalPage>
      <Title>Terms of Service</Title>
      <Updated>Last updated: {LAST_UPDATED}</Updated>

      <Text>
        FT_TRANSCENDENCE is a student project created as part of the 42
        curriculum. By using the application, you agree to these terms.
      </Text>

      <Heading>Use of the application</Heading>
      <Text>
        The application is provided for educational and demonstration purposes.
        You may use it to communicate with other users and access the features
        provided by the project.
      </Text>

      <Heading>Your account</Heading>
      <Text>
        You are responsible for your account and for keeping your login
        credentials secure. You must not access or attempt to access another
        user's account without permission.
      </Text>

      <Heading>Acceptable use</Heading>
      <Text>You must not use the application to:</Text>

      <List>
        <li>harass, threaten, or abuse other users;</li>
        <li>impersonate another person;</li>
        <li>send spam or malicious content;</li>
        <li>attack, disrupt, or misuse the application or its infrastructure.</li>
      </List>

      <Heading>Your content</Heading>
      <Text>
        You are responsible for the messages and other content you submit.
        Content may be stored and displayed as necessary to provide the
        application's features.
      </Text>

      <Heading>Moderation</Heading>
      <Text>
        Content may be removed and accounts may be restricted or deleted when
        necessary to prevent abuse or violations of these terms.
      </Text>

      <Heading>Availability</Heading>
      <Text>
        This is a student project and is provided as-is. The application may be
        changed, unavailable, reset, or discontinued at any time. Data is not
        guaranteed to be permanently stored.
      </Text>

      <Heading>Changes</Heading>
      <Text>
        These terms may be updated as the project changes. The latest update
        date is shown at the top of this page.
      </Text>
    </LegalPage>
  );
}

export default Terms;

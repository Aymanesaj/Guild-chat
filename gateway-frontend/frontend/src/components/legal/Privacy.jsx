import { Link } from "react-router-dom";
import LegalPage, { Title, Updated, Heading, Text, List } from "./LegalPage";

const LAST_UPDATED = "29 September 2026";

function Privacy() {
  return (
    <LegalPage>
      <Title>Privacy Policy</Title>
      <Updated>Last updated: {LAST_UPDATED}</Updated>

      <Text>
        FT_TRANSCENDENCE ("the app") is a chat application built as a student
        project at 42. This policy explains what personal data the app stores,
        why it stores it, and what you can do about it.
      </Text>

      <Heading>What we collect</Heading>
      <List>
        <li>
          <strong>Account data</strong> — your username, email address, display
          name and, for accounts created with a password, a hashed version of
          that password. Passwords are never stored in readable form.
        </li>
        <li>
          <strong>Profile data</strong> — the bio and avatar image you choose to
          add. Both are optional.
        </li>
        <li>
          <strong>Content you create</strong> — the rooms you create or join,
          your friends and friend requests, and the messages you send.
        </li>
        <li>
          <strong>Technical data</strong> — session and refresh tokens that keep
          you signed in, and server logs containing your IP address, the time of
          the request and the URL requested.
        </li>
      </List>

      <Heading>Why we use it</Heading>
      <Text>
        Only to run the app: to sign you in and keep you signed in, to show your
        profile to other users, to deliver your messages to the right rooms and
        people, and to keep the service working and secure. We do not sell your
        data, show you advertising, or build profiles about you.
      </Text>

      <Heading>Who can see it</Heading>
      <Text>
        Your username, display name, bio and avatar are visible to other users
        of the app. Messages are visible to the members of the room or
        conversation you send them to. Your email address and password are never
        shown to other users.
      </Text>
      <Text>
        We do not share your data with third parties. The one exception is
        GitHub, when you choose to sign in with it — that exchange is covered by
        GitHub's own privacy policy.
      </Text>

      <Heading>How long we keep it</Heading>
      <Text>
        Account and profile data are kept for as long as your account exists.
        Messages are kept until they are deleted. Refresh tokens expire
        automatically, and server logs are rotated regularly. Encrypted backups
        may hold a copy of deleted data for a short period before they are
        overwritten.
      </Text>

      <Heading>Your choices</Heading>
      <Text>
        You can view and change your display name, bio and avatar at any time
        from your profile in the app. To delete your account, obtain a copy of
        your data, or ask a question about this policy, contact the project
        maintainers using the details below.
      </Text>

      <Heading>Security</Heading>
      <Text>
        Traffic between your browser and the app is encrypted with HTTPS,
        passwords are hashed before being stored, and access to the databases is
        restricted to the app's own services. No system is perfectly secure, and
        this is a learning project provided without warranty.
      </Text>

      <Heading>Cookies and local storage</Heading>
      <Text>
        The app stores your session tokens in your browser so that you stay
        signed in. It uses no analytics, tracking or advertising cookies.
      </Text>

      <Heading>Changes to this policy</Heading>
      <Text>
        If this policy changes, the date at the top of this page will change
        with it.
      </Text>

      <Heading>Contact</Heading>
      <Text>
        Questions or requests can be sent to the project maintainers by opening
        an issue on the project's repository. See also our{" "}
        <Link to="/terms">Terms of Service</Link>.
      </Text>
    </LegalPage>
  );
}

export default Privacy;

import { Link } from "react-router-dom";
import LegalPage, { Title, Updated, Heading, Text, List } from "./LegalPage";

const LAST_UPDATED = "25 September 2026";

function Terms() {
  return (
    <LegalPage>
      <Title>Terms of Service</Title>
      <Updated>Last updated: {LAST_UPDATED}</Updated>

      <Text>
        By creating an account or using FT_TRANSCENDENCE ("the app") you agree
        to these terms. The app is a chat application built as a student project
        at 42 and is offered for educational and personal use only.
      </Text>

      <Heading>Your account</Heading>
      <Text>
        You must give accurate information when you register and keep your
        password to yourself. Everything done through your account is your
        responsibility. You must be old enough, in your country, to agree to
        these terms and to the processing of your data described in the{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </Text>

      <Heading>Acceptable use</Heading>
      <Text>While using the app, you must not:</Text>
      <List>
        <li>
          post content that is illegal, hateful, harassing, threatening or
          sexually explicit;
        </li>
        <li>impersonate another person or misrepresent who you are;</li>
        <li>spam other users, or scrape or automate traffic to the service;</li>
        <li>
          attempt to break into, overload or disrupt the app, its
          infrastructure, or another user's account.
        </li>
      </List>

      <Heading>Your content</Heading>
      <Text>
        You keep ownership of the messages, profile text and images you upload.
        By posting them you give us permission to store and display them as far
        as it is needed to operate the app. You are responsible for what you
        post and confirm you have the right to post it.
      </Text>

      <Heading>Moderation</Heading>
      <Text>
        We may remove content, or suspend or delete accounts, that break these
        terms. Room owners may also remove members from the rooms they manage.
      </Text>

      <Heading>Availability and liability</Heading>
      <Text>
        The app is provided "as is" and "as available", with no warranty of any
        kind. As a student project it may be unavailable, lose data, or be shut
        down at any time and without notice. To the fullest extent permitted by
        law, the maintainers are not liable for any loss or damage arising from
        your use of the app.
      </Text>

      <Heading>Ending your use</Heading>
      <Text>
        You may stop using the app and ask for your account to be deleted at any
        time. We may end your access if you break these terms.
      </Text>

      <Heading>Changes to these terms</Heading>
      <Text>
        These terms may be updated; the date at the top of this page will change
        when they are. Continuing to use the app after a change means you accept
        the updated terms.
      </Text>

      <Heading>Contact</Heading>
      <Text>
        Questions about these terms can be sent to the project maintainers by
        opening an issue on the project's repository.
      </Text>
    </LegalPage>
  );
}

export default Terms;

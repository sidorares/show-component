import { FormattedMessage } from 'react-intl';

/**
 * Scenario: FormattedMessage with string interpolation
 *
 * Uses ICU `{name}` placeholder with a string value. The output is still
 * a single text node so the span → FormattedMessage pattern applies.
 */
export function PersonalGreeting({ name }: { name: string }) {
  return (
    <p
      data-sc-test-id="intl-greeting"
      data-sc-expect-owner="PersonalGreeting"
      data-sc-expect-file="scenarios/IntlGreeting.tsx"
    >
      <span className="intl-text">
        <FormattedMessage
          id="greeting.personal"
                                      
          
                   
          
                     defaultMessage="Hello, {name}! Welcome back."
          description="Personal greeting with user name"
          values={{ name }}
        />
      </span>
    </p>
  );
}

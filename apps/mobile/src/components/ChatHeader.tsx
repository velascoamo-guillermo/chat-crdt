import { memo } from 'react';
import { Host, Row, Text, Button, Spacer, theme, statusColor } from '../ui';

interface Props {
  wsStatus: string;
  onlineCount: number;
  onLogout: () => void;
}

export const ChatHeader = memo(function ChatHeader({ wsStatus, onlineCount, onLogout }: Props) {
  return (
    <Host matchContents={{ vertical: true }} style={{ backgroundColor: theme.bg }}>
      <Row
        alignment="center"
        spacing={8}
        style={{ paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16 }}
      >
        <Text textStyle={{ fontSize: 18, fontWeight: '700', color: theme.textPrimary }}>
          # general
        </Text>
        <Spacer />
        <Text textStyle={{ fontSize: 14, color: statusColor(wsStatus) }}>●</Text>
        <Text textStyle={{ fontSize: 12, color: theme.textSecondary }}>
          {`${onlineCount} online`}
        </Text>
        <Button variant="text" label="Logout" onPress={onLogout} />
      </Row>
    </Host>
  );
});

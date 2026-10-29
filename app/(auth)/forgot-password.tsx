import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import i18n from '@/i18n';
import { authService } from '@/services/authService';
import { errorMessage, rawErrorMessage } from '@/utils/format';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resetErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (/rate limit|too many|seconds/i.test(raw)) return i18n.t('auth.forgot.errors.rateLimited');
  if (raw.includes('SUPABASE_REQUIRED')) return i18n.t('auth.forgot.errors.offline');
  return errorMessage(error, i18n.t('auth.forgot.errors.generic'));
}

/**
 * Step 1 of password recovery: ask for the e-mail and send the reset link.
 * The link opens /callback?next=reset-password, which leads to reset-password.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async () => {
    const address = email.trim().toLowerCase();
    if (!address) return setFieldError(t('auth.emailRequired'));
    if (!EMAIL_PATTERN.test(address)) return setFieldError(t('auth.emailInvalid'));
    setFieldError(undefined);
    setError(null);
    setSending(true);
    try {
      await authService.requestPasswordReset(address);
      setSentTo(address);
    } catch (sendError) {
      setError(resetErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader kicker={t('auth.forgot.kicker')} title={t('auth.forgot.title')} />
          {sentTo ? (
            <>
              <Notice title={t('auth.forgot.sentTitle')} tone="success">
                {t('auth.forgot.sentText', { email: sentTo })}
              </Notice>
              <Text style={styles.hint}>{t('auth.forgot.sentHint')}</Text>
              <ButtonPrimary onPress={() => router.replace('/(auth)/login')} title={t('auth.forgot.backToLogin')} />
              <ButtonSecondary disabled={sending} onPress={() => void send()} title={t('auth.forgot.sendAgain')} />
            </>
          ) : (
            <View style={styles.form}>
              <Text style={styles.subtitle}>{t('auth.forgot.subtitle')}</Text>
              {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}
              <TextField
                autoCapitalize="none"
                autoComplete="email"
                error={fieldError}
                keyboardType="email-address"
                label={t('auth.emailLabel')}
                onChangeText={(text) => {
                  setEmail(text);
                  if (fieldError) setFieldError(undefined);
                }}
                onSubmitEditing={() => void send()}
                placeholder={t('auth.emailPlaceholder')}
                returnKeyType="send"
                value={email}
              />
              <ButtonPrimary loading={sending} loadingTitle={t('auth.forgot.submitting')} onPress={() => void send()} title={t('auth.forgot.submit')} />
              <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  form: { gap: spacing[16] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
});

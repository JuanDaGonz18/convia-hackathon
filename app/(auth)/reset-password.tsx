import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { PasswordChecklist, PasswordField } from '@/components/forms/PasswordField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { profileService } from '@/services/profileService';
import { passwordErrorMessage, passwordFieldErrors } from '@/utils/password';

/**
 * Step 2 of password recovery: the reset link signed the user in (see
 * callback.tsx with ?next=reset-password); here they choose the new password.
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);

  const save = async () => {
    const errors = passwordFieldErrors(password, confirm);
    setFieldErrors(errors);
    if (errors.password || errors.confirm) return;
    setError(null);
    setSaving(true);
    try {
      await profileService.changePassword(password);
      toast.success(t('auth.reset.done'));
      router.replace('/(tabs)');
    } catch (saveError) {
      setError(passwordErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader kicker={t('auth.forgot.kicker')} title={t('auth.reset.title')} />
          {hasSession === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : !hasSession ? (
            <>
              <Notice title={t('auth.reset.expiredTitle')} tone="warning">
                {t('auth.reset.expiredText')}
              </Notice>
              <ButtonPrimary onPress={() => router.replace('/(auth)/forgot-password')} title={t('auth.reset.askAgain')} />
              <ButtonSecondary onPress={() => router.replace('/(auth)/login')} title={t('auth.forgot.backToLogin')} />
            </>
          ) : (
            <View style={styles.form}>
              <Text style={styles.subtitle}>{t('auth.reset.subtitle')}</Text>
              {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}
              <PasswordField
                autoComplete="new-password"
                error={fieldErrors?.password}
                label={t('auth.reset.newLabel')}
                onChangeText={(text) => {
                  setPassword(text);
                  if (fieldErrors) setFieldErrors(passwordFieldErrors(text, confirm));
                }}
                placeholder={t('auth.reset.newPlaceholder')}
                textContentType="newPassword"
                value={password}
              />
              <PasswordField
                autoComplete="new-password"
                error={fieldErrors?.confirm}
                label={t('auth.reset.confirmLabel')}
                onChangeText={(text) => {
                  setConfirm(text);
                  if (fieldErrors) setFieldErrors(passwordFieldErrors(password, text));
                }}
                onSubmitEditing={() => void save()}
                placeholder={t('auth.reset.confirmPlaceholder')}
                textContentType="newPassword"
                value={confirm}
              />
              {password || confirm ? <PasswordChecklist confirm={confirm} password={password} /> : null}
              <ButtonPrimary loading={saving} loadingTitle={t('auth.reset.submitting')} onPress={() => void save()} title={t('auth.reset.submit')} />
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
});

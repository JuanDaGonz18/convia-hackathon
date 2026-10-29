import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type InstitutionRequestRole, membershipService } from '@/services/membershipService';
import { errorMessage } from '@/utils/format';

const ROLES: InstitutionRequestRole[] = ['estudiante', 'profesor', 'administrativo', 'otro'];

/** "My institution isn't listed": a request the team reviews. The user stays pending meanwhile. */
export default function InstitutionRequestScreen() {
  const { t } = useTranslation();
  const [nombre, setNombre] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [sitioWeb, setSitioWeb] = useState('');
  const [rol, setRol] = useState<InstitutionRequestRole>('estudiante');
  const [errors, setErrors] = useState<{ nombre?: string; ciudad?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const found = {
      nombre: nombre.trim().length < 3 ? t('institutionRequest.nameRequired') : undefined,
      ciudad: ciudad.trim().length < 2 ? t('institutionRequest.cityRequired') : undefined,
    };
    setErrors(found);
    if (found.nombre || found.ciudad) return;
    setSaving(true);
    setError(null);
    try {
      await membershipService.requestInstitution({ nombre, ciudad, sitioWeb, rol });
      router.back();
    } catch (requestError) {
      setError(errorMessage(requestError, t('institutionRequest.failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader kicker={t('institution.kicker')} subtitle={t('institutionRequest.subtitle')} title={t('institutionRequest.title')} />
          <TextField error={errors.nombre} label={t('institutionRequest.name')} onChangeText={setNombre} placeholder={t('institutionRequest.namePlaceholder')} value={nombre} />
          <TextField error={errors.ciudad} label={t('institutionRequest.city')} onChangeText={setCiudad} placeholder={t('institutionRequest.cityPlaceholder')} value={ciudad} />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            label={t('institutionRequest.website')}
            onChangeText={setSitioWeb}
            placeholder="https://"
            value={sitioWeb}
          />
          <Text style={styles.label}>{t('institutionRequest.role')}</Text>
          <View accessibilityRole="radiogroup" style={styles.roles}>
            {ROLES.map((option) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: rol === option, selected: rol === option }}
                key={option}
                onPress={() => setRol(option)}
                style={[styles.role, rol === option && styles.roleSelected]}
              >
                <Text style={[styles.roleText, rol === option && styles.roleTextSelected]}>{t(`institutionRequest.roles.${option}`)}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <ButtonPrimary loading={saving} onPress={() => void submit()} title={t('institutionRequest.submit')} />
          <Text style={styles.hint}>{t('institutionRequest.after')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  label: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  role: { borderColor: colors.border, borderRadius: radius.radiusFull, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[16] },
  roleSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  roleText: { ...typography.bodySmall, color: colors.text },
  roleTextSelected: { color: colors.primary, fontWeight: '600' },
  hint: { ...typography.caption, color: colors.textSecondary },
});

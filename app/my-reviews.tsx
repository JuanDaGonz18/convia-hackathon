import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type Review, reviewService, summarize } from '@/services/reviewService';
import { useAppStore } from '@/store/appStore';
import { formatDateTime } from '@/utils/format';

function Stars({ score, size = 16 }: Readonly<{ score: number; size?: number }>) {
  return (
    <View accessibilityLabel={`${score}/5`} style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons color={colors.warning} key={n} name={score >= n ? 'star' : score >= n - 0.5 ? 'star-half' : 'star-outline'} size={size} />
      ))}
    </View>
  );
}

/** Profile → My reviews: what passengers (as a driver) or drivers (as a passenger) said, with the average. */
export default function MyReviewsScreen() {
  const { t } = useTranslation();
  const isDriver = useAppStore((state) => state.currentUser?.role === 'driver');
  const [as, setAs] = useState<'driver' | 'passenger'>(isDriver ? 'driver' : 'passenger');
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    reviewService.getMyReviews()
      .then((list) => { if (active) { setReviews(list); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []));

  const shown = useMemo(() => (reviews ?? []).filter((review) => review.as === as), [reviews, as]);
  const summary = summarize(shown);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('reviews.kicker')} title={t('reviews.title')} />

        <View accessibilityRole="tablist" style={styles.toggle}>
          {(['driver', 'passenger'] as const).map((option) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: as === option }}
              key={option}
              onPress={() => setAs(option)}
              style={[styles.toggleOption, as === option && styles.toggleSelected]}
            >
              <Text style={[styles.toggleText, as === option && styles.toggleTextSelected]}>{t(option === 'driver' ? 'reviews.asDriver' : 'reviews.asPassenger')}</Text>
            </Pressable>
          ))}
        </View>

        {failed ? <Notice tone="warning">{t('reviews.failed')}</Notice> : null}
        {!reviews && !failed ? <ActivityIndicator color={colors.primary} /> : null}

        {reviews ? (
          <View style={styles.summary}>
            <Text style={styles.average}>{summary.average === null ? '–' : summary.average.toFixed(1)}</Text>
            <View style={styles.summaryText}>
              <Stars score={summary.average ?? 0} size={20} />
              <Text style={styles.count}>{t('reviews.count', { count: summary.count })}</Text>
            </View>
          </View>
        ) : null}

        {reviews && !shown.length ? <Text style={styles.empty}>{t(as === 'driver' ? 'reviews.emptyDriver' : 'reviews.emptyPassenger')}</Text> : null}

        {shown.map((review) => (
          <View key={review.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Stars score={review.score} />
              <Text style={styles.date}>{formatDateTime(review.createdAt)}</Text>
            </View>
            {review.comment ? <Text style={styles.comment}>“{review.comment}”</Text> : <Text style={styles.noComment}>{t('reviews.noComment')}</Text>}
            <Text style={styles.rater}>{review.raterName ?? t('reviews.anonymous')}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  toggle: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusMedium, flexDirection: 'row', gap: spacing[4], padding: spacing[4] },
  toggleOption: { alignItems: 'center', borderRadius: radius.radiusSmall, flexBasis: 0, flexGrow: 1, justifyContent: 'center', minHeight: 44 },
  toggleSelected: { backgroundColor: colors.white },
  toggleText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  toggleTextSelected: { color: colors.primary },
  summary: { alignItems: 'center', flexDirection: 'row', gap: spacing[16] },
  average: { ...typography.headingXL, color: colors.text },
  summaryText: { gap: spacing[4] },
  count: { ...typography.bodySmall, color: colors.textSecondary },
  stars: { flexDirection: 'row', gap: 2 },
  empty: { ...typography.bodySmall, color: colors.textSecondary },
  card: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  date: { ...typography.caption, color: colors.textSecondary },
  comment: { ...typography.bodyMedium, color: colors.text },
  noComment: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic' },
  rater: { ...typography.caption, color: colors.textSecondary },
});

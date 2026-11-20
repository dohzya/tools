//! Round-trip properties.

use dz_encodings::base62::{self, Alphabet};
use dz_encodings::hangul;
use proptest::prelude::*;

proptest! {
    #[test]
    fn hangul_bytes_roundtrip_up_to_one_trailing_zero(
        bytes in proptest::collection::vec(any::<u8>(), 0..200),
        bits in 1u32..=13,
    ) {
        let text = hangul::encode_bytes_with_bits(&bytes, bits).unwrap();
        let back = hangul::decode_bytes_with_bits(&text, bits).unwrap();
        prop_assert!(back.len() >= bytes.len());
        prop_assert_eq!(&back[..bytes.len()], &bytes[..]);
        prop_assert!(back[bytes.len()..].iter().all(|b| *b == 0));
        prop_assert!(back.len() - bytes.len() <= 1);
    }

    #[test]
    fn hangul_digits_roundtrip(value in any::<u64>(), extra in 0usize..3) {
        let digits = 5 + extra; // 5 * 13 = 65 bits >= 64
        let text = hangul::encode_digits(u128::from(value), digits).unwrap();
        prop_assert_eq!(text.chars().count(), digits);
        prop_assert_eq!(hangul::decode_digits(&text).unwrap(), u128::from(value));
    }

    #[test]
    fn base62_bytes_roundtrip_without_leading_zeros(
        mut bytes in proptest::collection::vec(any::<u8>(), 1..100),
        first in 1u8..=255,
    ) {
        bytes[0] = first;
        for alpha in [Alphabet::Mrfi, Alphabet::Timestamp] {
            let text = base62::encode_bytes(&bytes, alpha);
            prop_assert_eq!(base62::decode_bytes(&text, alpha).unwrap(), bytes.clone());
        }
    }

    #[test]
    fn base62_bytes_roundtrip_with_leading_zeros(
        zeros in 0usize..8,
        tail in proptest::collection::vec(any::<u8>(), 0..60),
    ) {
        let mut bytes = vec![0u8; zeros];
        bytes.extend(&tail);
        for alpha in [Alphabet::Mrfi, Alphabet::Timestamp] {
            let text = base62::encode_bytes(&bytes, alpha);
            prop_assert_eq!(base62::decode_bytes(&text, alpha).unwrap(), bytes.clone());
        }
    }

    #[test]
    fn base62_unsigned_roundtrip(value in any::<u128>(), width in 0usize..30) {
        for alpha in [Alphabet::Mrfi, Alphabet::Timestamp] {
            let text = base62::encode_unsigned(value, width, alpha);
            prop_assert!(text.len() >= width);
            prop_assert_eq!(base62::decode_unsigned(&text, alpha).unwrap(), value);
        }
    }
}

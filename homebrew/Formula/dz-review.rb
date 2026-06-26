class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.3.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.3.0/dz-review-darwin-arm64"
      sha256 "546eb1529fbb7a9d24588d51aba5e5ac7467dc9ec5dc1e332917ce4133fec14a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.3.0/dz-review-darwin-x86_64"
      sha256 "f2d933ebec536f5f97f499aa7d060f70a65c038bd69b99d224431fe28aba7906"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.3.0/dz-review-linux-arm64"
      sha256 "50942ef0932335b518ad1bf303e3c4f22ec32523a9f4292113eb8fd99447fdf1"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.3.0/dz-review-linux-x86_64"
      sha256 "fa59717f3771235a1ab7d1dc16852b83734c6587bd43093e015c7317a87bf3f4"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "dz-review-darwin-arm64"
      else
        "dz-review-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "dz-review-linux-arm64"
      else
        "dz-review-linux-x86_64"
      end
    end

    bin.install binary_name => "dz-review"
  end

  test do
    system "#{bin}/dz-review", "--help"
  end
end

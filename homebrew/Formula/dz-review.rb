class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.4.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.0/dz-review-darwin-arm64"
      sha256 "4b50db1d52bd6b987dd75931028e2f561881a4dea0af53abd37696163c6d19c2"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.0/dz-review-darwin-x86_64"
      sha256 "17b1c03c85dbe7837928c7e2e87d2a2b57ffe6da187c8fa345bda6899d2c49b6"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.0/dz-review-linux-arm64"
      sha256 "ec725929ed4c30b4377a27f3791fd84c610c067d12c7861c10476a2c4c8d7b40"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.0/dz-review-linux-x86_64"
      sha256 "4d3af83f4d1efd734685e2be34b6f526e53b3b72d04bb0427e92869bcb603163"
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

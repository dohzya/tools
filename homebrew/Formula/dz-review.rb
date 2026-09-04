class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.4.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.1/dz-review-darwin-arm64"
      sha256 "af6ac54df1f65e43ac7015b027fd6e585c3a13474a4146310aeae2228a9efb0d"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.1/dz-review-darwin-x86_64"
      sha256 "f6712b38c848f8a8102d05f3bc26e5e9ec4d2434ed679f4ca07374d592027231"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.1/dz-review-linux-arm64"
      sha256 "3e0beff84a431caf61aa4a330eac47b6da2841f997061e7a8d7151e7fb5ff0c0"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.1/dz-review-linux-x86_64"
      sha256 "9a980d6a69de5b7fac9fdf55a6fa7563f9a6e37d3862040dfc303adee8804e69"
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
